import { ItemView, WorkspaceLeaf } from "obsidian";
import manifest from "manifest.json";

import type { TaskIndexService } from "@features/task-index";
import type { SettingsService } from "@settings";
import type { OrgStructurePort } from "@features/org-structure";

import { DashboardController } from "../../app/controller";

export const VIEW_TYPE_AGILE_DASHBOARD = "agile-dashboard-view";

export type AgileDashboardViewPorts = {
	taskIndex?: TaskIndexService;
	settings: SettingsService;
	orgStructure?: OrgStructurePort;
	manifestId?: string;
};

type TaskIndexSnapshot = ReturnType<TaskIndexService["getSnapshot"]>;

function createNullTaskIndexService(): TaskIndexService {
	const emptySnapshot: TaskIndexSnapshot = {};

	return {
		async buildAll() {},
		async updateFile() {},
		removeFile() {},
		renameFile() {},
		getSnapshot() {
			return emptySnapshot;
		},
		getAllTasks() {
			return [];
		},
		getByFile() {
			return undefined;
		},
		getById() {
			return undefined;
		},
		getItemAtCursor() {
			return undefined;
		},
		getTaskByBlockRef() {
			return undefined;
		},
	};
}

export class AgileDashboardView extends ItemView {
	private taskIndexService: TaskIndexService;
	private settingsService: SettingsService;
	private orgStructurePort?: OrgStructurePort;
	private controller!: DashboardController;
	private storageKey: string;

	constructor(leaf: WorkspaceLeaf, ports: AgileDashboardViewPorts) {
		super(leaf);
		this.settingsService = ports.settings;
		this.orgStructurePort = ports.orgStructure;

		const svc = ports.taskIndex;
		if (!svc) {
			console.warn(
				"[AgileDashboardView] TaskIndexService not found in ports."
			);
			this.taskIndexService = createNullTaskIndexService();
		} else {
			this.taskIndexService = svc;
		}

		const mid = (ports.manifestId || "").trim() || "agile-default";
		this.storageKey = `agile:selected-team-slugs:${mid}`;
	}

	getViewType(): string {
		return VIEW_TYPE_AGILE_DASHBOARD;
	}

	getDisplayText(): string {
		return "Agile dashboard";
	}

	getIcon(): string {
		return "calendar-clock";
	}

	async onOpen(): Promise<void> {
		const rawVersion =
			(manifest as { version?: string | number | null }).version;
		const manifestVersion =
			typeof rawVersion === "string" || typeof rawVersion === "number"
				? String(rawVersion)
				: "";

		this.controller = new DashboardController({
			app: this.app,
			view: this,
			taskIndexService: this.taskIndexService,
			settingsService: this.settingsService,
			orgStructurePort: this.orgStructurePort,
			manifestVersion,
			storageKey: this.storageKey,
			register: (fn) => this.register(fn),
			registerEvent: (evt) => this.registerEvent(evt),
			registerDomEvent: (
				el: HTMLElement | Window | Document,
				type: string,
				handler: (evt: Event) => void,
				options?: AddEventListenerOptions | boolean
			) => {
				// Bridge Obsidian's overloaded registerDomEvent (Window/Document/HTMLElement)
				// to the union-typed callback used by the dashboard modules without using `any`.
				(
					this as unknown as {
						registerDomEvent: (
							el: HTMLElement | Window | Document,
							type: string,
							handler: (evt: Event) => void,
							options?: AddEventListenerOptions | boolean
						) => void;
					}
				).registerDomEvent(el, type, handler, options);
			},
		});

		this.controller.mount();
	}

	async onClose(): Promise<void> {
		if (this.controller) this.controller.unmount();
	}
}