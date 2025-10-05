import type { App, ItemView } from "obsidian";
import type { TaskIndexService } from "@features/task-index";
import type { SettingsService } from "@settings";
import type { OrgStructurePort } from "@features/org-structure";
import { renderControlsBar } from "../ui/components/controls-bar";
import { attachDashboardAssignmentHandler } from "../ui/handlers/assignment-handler";
import { attachDashboardTemplatingHandler } from "../ui/handlers/templating-handler";
import { wireDashboardEvents } from "../ui/handlers/event-wiring";
import { TeamSelection } from "../domain/team-selection";
import type { DashboardState } from "../domain/view-state";
import { captureScroll, restoreScroll } from "../ui/utils/scroll";
import {
	renderTeamsPopupContent,
	TeamsPopupContext,
} from "../ui/views/teams-popup";
import { renderProjectView } from "../ui/views/project-view";
import { refreshForFile } from "./refresh-service";

type RegisterFn = (fn: () => void) => void;
type RegisterEventFn = (evt: any) => void;
type RegisterDomEvent = (
	el: HTMLElement | Window | Document,
	type: string,
	handler: (evt: any) => void,
	options?: AddEventListenerOptions | boolean
) => void;

export interface DashboardControllerDeps {
	app: App;
	view: ItemView;
	taskIndexService: TaskIndexService;
	settingsService: SettingsService;
	orgStructurePort?: OrgStructurePort;
	manifestVersion: string;
	storageKey: string;

	register: RegisterFn;
	registerEvent: RegisterEventFn;
	registerDomEvent: RegisterDomEvent;
}

export class DashboardController {
	private state: DashboardState;
	private readonly teamSelection: TeamSelection;
	private teamsPopupEl: HTMLDivElement | null = null;
	private outsideClickHandler: ((ev: MouseEvent) => void) | null = null;
	private suppressedFiles = new Set<string>();

	constructor(private readonly deps: DashboardControllerDeps) {
		const initialAlias =
			deps.settingsService.getRaw().currentUserAlias || null;
		this.teamSelection = new TeamSelection(
			deps.settingsService,
			deps.orgStructurePort,
			deps.storageKey
		);
		this.state = {
			selectedView: "projects",
			activeOnly: true,
			selectedAlias: initialAlias,
		};
	}

	mount() {
		const container = this.getViewContainer();
		container.empty();

		// Controls
		renderControlsBar({
			container,
			version: this.deps.manifestVersion,
			settingsService: this.deps.settingsService,
			initialView: this.state.selectedView,
			initialActiveOnly: this.state.activeOnly,
			initialAlias: this.state.selectedAlias,
			onViewChange: (v) => {
				this.state.selectedView = v;
				this.updateView();
			},
			onActiveToggleChange: (active) => {
				this.state.activeOnly = active;
				this.updateView();
			},
			onMemberChange: (alias) => {
				this.state.selectedAlias = alias;
				this.teamSelection.restrictSelectedTeamsToUserMembership(
					this.state.selectedAlias
				);
				this.updateView();
				if (this.teamsPopupEl) this.renderTeamsPopup();
			},
			onSelectTeamsClick: (anchor) => this.toggleTeamsPopup(anchor),
		});

		// Handlers (assignment + templating)
		attachDashboardAssignmentHandler({
			app: this.deps.app,
			orgStructurePort: this.deps.orgStructurePort,
			viewContainer: container,
			registerDomEvent: this.deps.registerDomEvent,
		});

		attachDashboardTemplatingHandler({
			app: this.deps.app,
			viewContainer: container,
			registerDomEvent: this.deps.registerDomEvent,
			refreshForFile: async (filePath?: string | null) => {
				await refreshForFile(
					this.deps.app,
					this.deps.taskIndexService,
					filePath
				);
				await this.updateView();
			},
		});

		// Initial render
		void this.updateView();

		// Event wiring (event bus + vault)
		wireDashboardEvents({
			app: this.deps.app,
			taskIndexService: this.deps.taskIndexService,
			viewRoot: container,
			getSelectedAlias: () => this.state.selectedAlias,
			updateView: () => this.updateView(),
			suppressedFiles: this.suppressedFiles,
			register: this.deps.register,
			registerEvent: this.deps.registerEvent,
		});
	}

	unmount() {
		this.closeTeamsPopup();
		if (this.outsideClickHandler) {
			try {
				window.removeEventListener("click", this.outsideClickHandler, {
					capture: true,
				} as any);
			} catch {}
			this.outsideClickHandler = null;
		}
	}

	// Rendering
	private getViewContainer(): HTMLElement {
		return (this.deps.view as any).containerEl.children[1] as HTMLElement;
	}

	private getOrCreateContentContainer(parent: HTMLElement): HTMLElement {
		const existing = parent.querySelector(
			".content-container"
		) as HTMLElement | null;
		return existing ?? parent.createEl("div", { cls: "content-container" });
	}

	async updateView() {
		const parent = this.getViewContainer();
		const scroll = captureScroll(parent);

		const content = this.getOrCreateContentContainer(parent);
		content.empty();

		if (this.state.selectedView === "projects") {
			await renderProjectView({
				app: this.deps.app,
				container: content,
				taskIndexService: this.deps.taskIndexService,
				settingsService: this.deps.settingsService,
				teamSelection: this.teamSelection,
				statusActive: this.state.activeOnly,
				selectedAlias: this.state.selectedAlias,
				registerDomEvent: this.deps.registerDomEvent,
			});
		} else {
			content.createEl("h2", { text: "✅ Completed (Coming Soon)" });
		}

		restoreScroll(parent, scroll);
	}

	// Teams popup
	private toggleTeamsPopup(anchor: HTMLElement) {
		if (this.teamsPopupEl) {
			this.closeTeamsPopup();
			return;
		}
		this.openTeamsPopup(anchor);
	}

	private openTeamsPopup(anchor: HTMLElement) {
		this.closeTeamsPopup();
		const popup = document.createElement("div");
		this.teamsPopupEl = popup;
		popup.classList.add("agile-teams-popup");
		popup.style.position = "absolute";
		popup.style.right = "0";
		popup.style.top = "calc(100% + 8px)";
		popup.style.zIndex = "9999";
		popup.style.minWidth = "320px";
		popup.style.maxWidth = "520px";
		popup.style.maxHeight = "60vh";
		popup.style.overflow = "auto";
		popup.style.padding = "10px";
		popup.style.border = "1px solid var(--background-modifier-border)";
		popup.style.borderRadius = "8px";
		popup.style.background = "var(--background-primary)";
		popup.style.boxShadow = "0 6px 24px rgba(0,0,0,0.2)";
		anchor.parentElement?.appendChild(popup);
		this.renderTeamsPopup();
	}

	private closeTeamsPopup() {
		if (this.teamsPopupEl) {
			try {
				this.teamsPopupEl.remove();
			} catch {}
			this.teamsPopupEl = null;
		}
	}

	private renderTeamsPopup() {
		if (!this.teamsPopupEl) return;

		const ctx: TeamsPopupContext = {
			root: this.teamsPopupEl,
			orgStructurePort: this.deps.orgStructurePort,
			selectedTeamSlugs: this.teamSelection.getSelectedTeamSlugs(),
			implicitAllSelected: this.teamSelection.getImplicitAllSelected(),
			setImplicitAllSelected: (val: boolean) => {
				this.teamSelection.setImplicitAllSelected(val);
			},
			addSelectedSlugs: (slugs: string[]) => {
				this.teamSelection.addSelectedSlugs(slugs);
			},
			removeSelectedSlugs: (slugs: string[]) => {
				this.teamSelection.removeSelectedSlugs(slugs);
			},
			onSelectionChanged: () => {
				this.renderTeamsPopup();
				this.updateView();
			},
			getAllowedTeamSlugsForSelectedUser: () =>
				this.teamSelection.getAllowedTeamSlugsForSelectedUser(
					this.state.selectedAlias
				),
		};

		renderTeamsPopupContent(ctx);
	}
}
