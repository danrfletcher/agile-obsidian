import { ItemView, WorkspaceLeaf, TFile, TAbstractFile } from "obsidian";
import manifest from "manifest.json";
import { cleanupExpiredSnoozes } from "@features/task-snooze";
import { getCurrentUserDisplayName } from "@settings/index";

// Section processors
import { processAndRenderObjectives } from "../components/objectives";
import { processAndRenderArtifacts } from "../components/artifacts";
import { processAndRenderInitiatives } from "../components/initiatives";
import { processAndRenderResponsibilities } from "../components/responsibilities";
import { processAndRenderPriorities } from "../components/priorities";

// New imports for the refactored Task Index
import type {
	TaskItem,
	TaskNode,
} from "@features/task-index/domain/task-types";
import type { TaskIndexService } from "@features/task-index";
import type { SettingsService } from "@settings";

export const VIEW_TYPE_AGILE_DASHBOARD = "agile-dashboard-view";

export type AgileDashboardViewPorts = {
	taskIndex?: TaskIndexService;
	settings: SettingsService;
};

export class AgileDashboardView extends ItemView {
	private taskIndexService: TaskIndexService;
	private settingsService: SettingsService;

	private viewSelect: HTMLSelectElement;
	private activeToggle: HTMLInputElement;
	private activeToggleLabel: HTMLSpanElement;
	private memberSelect: HTMLSelectElement;
	private suppressedFiles = new Set<string>();

	constructor(leaf: WorkspaceLeaf, ports: AgileDashboardViewPorts) {
		super(leaf);
		this.settingsService = ports.settings;

		// Wire the TaskIndex service through ports, with a no-op fallback
		const svc = ports.taskIndex;
		if (!svc) {
			console.warn(
				"[AgileDashboardView] TaskIndexService not found in ports. The dashboard will be empty."
			);
			this.taskIndexService = {
				// minimal no-op facade (typed as TaskIndexService)
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
		const container = this.containerEl.children[1];
		container.empty();

		// Controls
		const controlsContainer = container.createEl("div", {
			attr: { style: "display: flex; align-items: center; gap: 10px;" },
		});

		const versionText = controlsContainer.createEl("p");
		const strongText = versionText.createEl("strong");
		strongText.textContent = `Agile Obsidian v${manifest.version}`;

		this.viewSelect = controlsContainer.createEl("select", {
			attr: { style: "margin-right: 10px;" },
		});
		this.viewSelect.innerHTML = `
      <option value="projects">🚀 Projects</option>
      <option value="completed">✅ Completed</option>
    `;

		const statusToggleContainer = controlsContainer.createEl("span", {
			attr: {
				style: "display: inline-flex; align-items: center; gap: 6px;",
			},
		});
		this.activeToggleLabel = statusToggleContainer.createEl("span", {
			text: "Active",
		});
		this.activeToggle = statusToggleContainer.createEl("input", {
			type: "checkbox",
		}) as HTMLInputElement;
		this.activeToggle.checked = true;
		statusToggleContainer.style.display =
			this.viewSelect.value === "projects" ? "inline-flex" : "none";

		this.activeToggle.addEventListener("change", () => {
			this.activeToggleLabel.textContent = this.activeToggle.checked
				? "Active"
				: "Inactive";
			this.updateView();
		});

		this.viewSelect.addEventListener("change", () => {
			statusToggleContainer.style.display =
				this.viewSelect.value === "projects" ? "inline-flex" : "none";
			this.updateView();
		});

		// Member dropdown
		this.memberSelect = controlsContainer.createEl("select");

		const populateMemberSelect = () => {
			this.memberSelect.innerHTML = "";

			type Entry = {
				alias: string;
				name: string;
				role: string;
				rank: number;
				label: string;
			};
			const entries: Entry[] = [];

			const settings = this.settingsService.getRaw();
			const teams = settings.teams || [];
			const seen = new Set<string>();
			for (const t of teams) {
				for (const m of t.members || []) {
					const alias = (m.alias || "").trim();
					const dispName = m.name || alias;
					if (!alias) continue;
					if (seen.has(alias)) continue;
					seen.add(alias);
					const lower = alias.toLowerCase();
					let role = m.type || "member";
					if (lower.endsWith("-ext")) role = "external";
					else if (lower.endsWith("-team")) role = "team";
					else if (lower.endsWith("-int"))
						role = "internal-team-member";
					const rank =
						role === "member"
							? 0
							: role === "internal-team-member"
							? 1
							: role === "team"
							? 2
							: 3;
					const roleLabel =
						role === "member"
							? "Team Member"
							: role === "internal-team-member"
							? "Internal Team Member"
							: role === "team"
							? "Internal Team"
							: "External Delegate";
					const label = `${dispName} (${roleLabel} - ${alias})`;
					entries.push({ alias, name: dispName, role, rank, label });
				}
			}

			entries.sort(
				(a, b) => a.rank - b.rank || a.name.localeCompare(b.name)
			);

			for (const e of entries) {
				const opt = document.createElement("option");
				opt.value = e.alias;
				opt.text = e.label;
				this.memberSelect.appendChild(opt);
			}

			const def = this.settingsService.getRaw().currentUserAlias || "";
			if (def && entries.some((e) => e.alias === def)) {
				this.memberSelect.value = def;
			} else if (entries.length > 0) {
				this.memberSelect.value = entries[0].alias;
			}
		};

		populateMemberSelect();

		this.memberSelect.addEventListener("change", () => {
			this.updateView();
		});

		// Listen for settings changes to auto-refresh
		this.registerEvent(
			// @ts-ignore Obsidian typings do not include custom events
			this.app.workspace.on("agile-settings-changed", () => {
				if (this.memberSelect) {
					const prev = this.memberSelect.value;
					typeof populateMemberSelect === "function" &&
						(populateMemberSelect as any)();
					if (
						prev &&
						Array.from(this.memberSelect.options).some(
							(o) => o.value === prev
						)
					) {
						this.memberSelect.value = prev;
					}
				}
				this.updateView();
			})
		);

		// Local optimistic updates suppression
		this.registerDomEvent(
			window,
			"agile:prepare-optimistic-file-change" as any,
			(e: Event) => {
				const ev = e as CustomEvent<{ filePath: string }>;
				if (ev.detail?.filePath) {
					this.suppressedFiles.add(ev.detail.filePath);
				}
			}
		);
		this.registerDomEvent(
			window,
			"agile:task-snoozed" as any,
			async (e: Event) => {
				const ev = e as CustomEvent<{ uid: string; filePath: string }>;
				const filePath = ev.detail?.filePath;
				if (filePath) {
					this.suppressedFiles.add(filePath);
					const file = this.app.vault.getAbstractFileByPath(filePath);
					if (file instanceof TFile) {
						await this.taskIndexService.updateFile(file);
					}
				}
			}
		);

		// Initial render
		await this.updateView();

		// Auto-refresh on vault changes.
		// IMPORTANT: We do not rebuild index ourselves here;
		// We simply keep the local view current by calling updateFile/remove/rename
		// on the shared TaskIndexService instance.
		this.registerEvent(
			this.app.vault.on("modify", async (file: TFile) => {
				if (file.extension === "md") {
					await this.taskIndexService.updateFile(file);
					if (this.suppressedFiles.has(file.path)) {
						this.suppressedFiles.delete(file.path);
						return; // Suppress full rerender; local DOM already updated
					}
					this.updateView();
				}
			})
		);
		this.registerEvent(
			this.app.vault.on("create", async (file: TAbstractFile) => {
				if (file instanceof TFile && file.extension === "md") {
					await this.taskIndexService.updateFile(file);
					this.updateView();
				}
			})
		);
		this.registerEvent(
			this.app.vault.on("delete", (file: TAbstractFile) => {
				if (file instanceof TFile && file.extension === "md") {
					this.taskIndexService.removeFile(file.path);
					this.updateView();
				}
			})
		);
		this.registerEvent(
			this.app.vault.on(
				"rename",
				async (file: TAbstractFile, oldPath: string) => {
					if (file instanceof TFile && file.extension === "md") {
						// Use repository-native rename to update IDs/links immutably
						this.taskIndexService.renameFile(oldPath, file.path);
						this.updateView();
					}
				}
			)
		);
	}

	async onClose() {
		// Cleanup if needed
	}

	private async updateView() {
		const viewContainer = this.containerEl.children[1] as HTMLElement;
		const existingContent = viewContainer.querySelector(
			".content-container"
		) as HTMLElement | null;
		const prevContainerScrollTop = viewContainer.scrollTop;
		const prevContentScrollTop = existingContent?.scrollTop ?? 0;

		const contentContainer =
			existingContent ??
			viewContainer.createEl("div", { cls: "content-container" });
		contentContainer.empty();

		const selectedView = this.viewSelect.value;
		const isActive = this.activeToggle ? this.activeToggle.checked : true;
		const selectedAlias =
			this.memberSelect?.value ||
			this.settingsService.getRaw().currentUserAlias ||
			null;

		if (selectedView === "projects") {
			await this.projectView(contentContainer, isActive, selectedAlias);
		} else if (selectedView === "completed") {
			contentContainer.createEl("h2", {
				text: "✅ Completed (Coming Soon)",
			});
		}

		viewContainer.scrollTop = prevContainerScrollTop;
		contentContainer.scrollTop = prevContentScrollTop;
	}

	private async projectView(
		container: HTMLElement,
		status = true,
		selectedAlias: string | null = null
	) {
		// Get all tasks from the shared index
		let currentTasks: TaskNode[] = this.taskIndexService.getAllTasks();

		// Clean up expired snoozes for current user before rendering
		const settings = this.settingsService.getRaw();
		const changedFiles = await cleanupExpiredSnoozes(
			this.app,
			currentTasks,
			getCurrentUserDisplayName(settings) || ""
		);
		if (changedFiles.size > 0) {
			for (const path of changedFiles) {
				const file = this.app.vault.getAbstractFileByPath(path);
				if (file instanceof TFile) {
					await this.taskIndexService.updateFile(file);
				}
			}
			currentTasks = this.taskIndexService.getAllTasks();
		}

		// Build taskMap and childrenMap
		const taskMap = new Map<string, TaskItem>();
		const childrenMap = new Map<string, TaskItem[]>();
		currentTasks.forEach((t) => {
			if (t._uniqueId) {
				taskMap.set(t._uniqueId, t);
				childrenMap.set(t._uniqueId, []);
			}
		});
		currentTasks.forEach((t) => {
			if (t._parentId && childrenMap.has(t._parentId)) {
				childrenMap.get(t._parentId)!.push(t);
			}
		});

		const taskParams = {
			inProgress: true,
			completed: false,
			sleeping: false,
			cancelled: false,
		};
		if (settings.showResponsibilities) {
			processAndRenderResponsibilities(
				container,
				currentTasks,
				status,
				selectedAlias,
				this.app,
				taskMap,
				childrenMap,
				taskParams
			);
		}
		if (settings.showObjectives) {
			processAndRenderObjectives(
				container,
				currentTasks,
				status,
				selectedAlias,
				this.app,
				taskMap,
				childrenMap,
				taskParams
			);
		}

		processAndRenderArtifacts(
			container,
			currentTasks,
			status,
			selectedAlias,
			this.app,
			taskMap,
			childrenMap,
			taskParams,
			settings
		);

		if (settings.showInitiatives) {
			processAndRenderInitiatives(
				container,
				currentTasks,
				status,
				selectedAlias,
				this.app,
				taskMap,
				childrenMap,
				taskParams
			);
		}
		if (settings.showPriorities) {
			processAndRenderPriorities(
				container,
				currentTasks,
				status,
				selectedAlias,
				this.app,
				taskMap,
				childrenMap,
				taskParams
			);
		}
	}
}
