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
			this.taskIndexService = {
				buildAll: async () => {},
				updateFile: async () => {},
				removeFile: () => {},
				renameFile: () => {},
				getSnapshot: () => ({} as any),
				getAllTasks: () => [],
				getByFile: () => undefined,
				getById: () => undefined,
				getItemAtCursor: () => undefined,
			} as unknown as TaskIndexService;
		} else {
			this.taskIndexService = svc;
		}

		const mid = (ports.manifestId || "").trim() || "agile-default";
		this.storageKey = `agile:selected-team-slugs:${mid}`;
	}

	getViewType() {
		return VIEW_TYPE_AGILE_DASHBOARD;
	}

	getDisplayText() {
		return "Agile Dashboard";
	}

	getIcon() {
		return "calendar-clock";
	}

	async onOpen() {
		this.controller = new DashboardController({
			app: this.app,
			view: this,
			taskIndexService: this.taskIndexService,
			settingsService: this.settingsService,
			orgStructurePort: this.orgStructurePort,
			manifestVersion: manifest.version,
			storageKey: this.storageKey,
			register: this.register.bind(this),
			registerEvent: this.registerEvent.bind(this),
			registerDomEvent: this.registerDomEvent.bind(this),
		});

		this.controller.mount();
	}

	async onClose() {
		if (this.controller) this.controller.unmount();
	}
}
