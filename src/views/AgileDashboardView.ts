import { ItemView, WorkspaceLeaf, TFile, TAbstractFile } from "obsidian";
import { TaskIndex } from "../index/TaskIndex";
import { TaskItem } from "../types/TaskItem";
import { version, name } from "../utils/config/config";
import { cleanupExpiredSnoozes } from "../utils/snooze/snoozeUtils";

// Section processors
import { processAndRenderObjectives } from "./sections/ObjectivesProcessor";
import { processAndRenderTasks } from "./sections/TasksProcessor";
import { processAndRenderStories } from "./sections/StoriesProcessor";
import { processAndRenderEpics } from "./sections/EpicsProcessor";
import { processAndRenderInitiatives } from "./sections/InitiativesProcessor";
import { processAndRenderResponsibilities } from "./sections/ResponsibilitiesProcessor";
import { processAndRenderPriorities } from "./sections/PrioritiesProcessor";
import type AgileObsidianPlugin from "../main";

export const VIEW_TYPE_AGILE_DASHBOARD = "agile-dashboard-view";

export class AgileDashboardView extends ItemView {
	private taskIndex: TaskIndex;
	private viewSelect: HTMLSelectElement;
	private projectStatusSelect: HTMLSelectElement;
	private plugin: AgileObsidianPlugin; // New: Store the plugin instance for settings access
	private suppressedFiles = new Set<string>();

	constructor(leaf: WorkspaceLeaf, plugin: AgileObsidianPlugin) {
		// Updated: Accept plugin
		super(leaf);
		this.plugin = plugin; // New: Assign plugin
		this.taskIndex = this.plugin.taskIndex; // Updated: Access taskIndex from plugin
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

		// UI Controls (from original)
		const controlsContainer = container.createEl("div", {
			attr: { style: "display: flex; align-items: center; gap: 10px;" },
		});

		const versionText = controlsContainer.createEl("p");
		const strongText = versionText.createEl("strong");
		strongText.textContent = `Agile Obsidian v${version}`;

		this.viewSelect = controlsContainer.createEl("select", {
			attr: { style: "margin-right: 10px;" },
		});
		this.viewSelect.innerHTML = `
      <option value="projects">🚀 Projects</option>
      <option value="deadlines">❗ Deadlines</option>
      <option value="completed">✅ Completed</option>
    `;

		this.projectStatusSelect = controlsContainer.createEl("select");
		this.projectStatusSelect.innerHTML = `
      <option value="active">Active</option>
      <option value="inactive">Inactive</option>
    `;
		this.projectStatusSelect.style.display =
			this.viewSelect.value === "projects" ? "inline-block" : "none";

		this.viewSelect.addEventListener("change", () => {
			this.projectStatusSelect.style.display =
				this.viewSelect.value === "projects" ? "inline-block" : "none";
			this.updateView();
		});

		this.projectStatusSelect.addEventListener("change", () => {
			this.updateView();
		});

		// New: Listen for settings changes to auto-refresh
		this.registerEvent(
			// @ts-ignore - Suppress type error for custom event (Obsidian typings don't support arbitrary events)
			this.app.workspace.on("agile-settings-changed", () => {
				this.updateView(); // Force re-render with new settings
			})
		);

		// Listen for local optimistic updates to avoid full rerenders
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
						await this.taskIndex.updateFile(file);
					}
				}
			}
		);

		// Initial render
		await this.updateView();

		// Register events for auto-refresh on vault changes
		this.registerEvent(
			this.app.vault.on("modify", async (file: TFile) => {
				if (file.extension === "md") {
					await this.taskIndex.updateFile(file);
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
					await this.taskIndex.updateFile(file);
					this.updateView();
				}
			})
		);
		this.registerEvent(
			this.app.vault.on("delete", (file: TAbstractFile) => {
				if (file instanceof TFile && file.extension === "md") {
					this.taskIndex.removeFile(file.path);
					this.updateView();
				}
			})
		);
		this.registerEvent(
			this.app.vault.on(
				"rename",
				async (file: TAbstractFile, oldPath: string) => {
					if (file instanceof TFile && file.extension === "md") {
						this.taskIndex.removeFile(oldPath);
						await this.taskIndex.updateFile(file);
						this.updateView();
					}
				}
			)
		);
	}

	async onClose() {
		// Cleanup events if needed
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
		contentContainer.empty(); // Clear previous content (keep controls)

		const selectedView = this.viewSelect.value;
		const isActive = this.projectStatusSelect.value === "active";

		if (selectedView === "projects") {
			await this.projectView(contentContainer, isActive);
		} else if (selectedView === "deadlines") {
			// Placeholder for deadlineView
			contentContainer.createEl("h2", {
				text: "❗ Deadlines (Coming Soon)",
			});
		} else if (selectedView === "completed") {
			// Placeholder for completedView
			contentContainer.createEl("h2", {
				text: "✅ Completed (Coming Soon)",
			});
		}

		// Restore scroll position after render
		viewContainer.scrollTop = prevContainerScrollTop;
		contentContainer.scrollTop = prevContentScrollTop;
	}

	private async projectView(container: HTMLElement, status = true) {
		// Get all tasks from index
		let currentTasks = this.taskIndex.getAllTasks();

		// Clean up expired snoozes for current user before rendering
		const changedFiles = await cleanupExpiredSnoozes(
			this.app,
			currentTasks,
			name
		);
		if (changedFiles.size > 0) {
			for (const path of changedFiles) {
				const file = this.app.vault.getAbstractFileByPath(path);
				if (file instanceof TFile) {
					await this.taskIndex.updateFile(file);
				}
			}
			// Re-fetch tasks after cleanup
			currentTasks = this.taskIndex.getAllTasks();
		}

		// Build shared taskMap and childrenMap (from original)
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
				childrenMap.get(t._parentId)?.push(t); // Safe
			}
		});

		// Get task params from UI & view
		const taskParams = {
			inProgress: true,
			completed: false,
			sleeping: false,
			cancelled: false,
		};

		// Call each section processor conditionally based on settings
		if (this.plugin.settings.showObjectives) {
			processAndRenderObjectives(
				container,
				currentTasks,
				status,
				this.app,
				taskMap,
				childrenMap,
				taskParams
			);
		}
		if (this.plugin.settings.showTasks) {
			processAndRenderTasks(
				container,
				currentTasks,
				status,
				this.app,
				taskMap,
				childrenMap,
				taskParams
			);
		}
		if (this.plugin.settings.showStories) {
			processAndRenderStories(
				container,
				currentTasks,
				status,
				this.app,
				taskMap,
				childrenMap,
				taskParams
			);
		}
		if (this.plugin.settings.showEpics) {
			processAndRenderEpics(
				container,
				currentTasks,
				status,
				this.app,
				taskMap,
				childrenMap,
				taskParams
			);
		}
		if (this.plugin.settings.showInitiatives) {
			processAndRenderInitiatives(
				container,
				currentTasks,
				status,
				this.app,
				taskMap,
				childrenMap,
				taskParams
			);
		}
		if (this.plugin.settings.showResponsibilities) {
			processAndRenderResponsibilities(
				container,
				currentTasks,
				status,
				this.app,
				taskMap,
				childrenMap,
				taskParams
			);
		}
		if (this.plugin.settings.showPriorities) {
			processAndRenderPriorities(
				container,
				currentTasks,
				status,
				this.app,
				taskMap,
				childrenMap,
				taskParams
			);
		}
	}
}
