import { ItemView, WorkspaceLeaf, TFile, TAbstractFile } from "obsidian";
import { TaskIndex } from "../index/TaskIndex"; // Adjust path if needed
import { TaskItem } from "../types/TaskItem"; // Adjust path if needed
import { version } from "../utils/config";
import { processAndRenderObjectives } from "./sections/ObjectivesProcessor";
import { processAndRenderTasks } from "./sections/TasksProcessor";
import { processAndRenderStories } from "./sections/StoriesProcessor";
import { processAndRenderEpics } from "./sections/EpicsProcessor";
import { processAndRenderInitiatives } from "./sections/InitiativesProcessor";
import { processAndRenderResponsibilities } from "./sections/ResponsibilitiesProcessor";
import { processAndRenderPriorities } from "./sections/PrioritiesProcessor";

export const VIEW_TYPE_AGILE_DASHBOARD = "agile-dashboard-view";

export class AgileDashboardView extends ItemView {
	private taskIndex: TaskIndex;
	private viewSelect: HTMLSelectElement;
	private projectStatusSelect: HTMLSelectElement;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
		const appWithPlugins = this.app as {
			plugins?: { plugins: Record<string, unknown> };
		};
		const plugin = appWithPlugins.plugins?.plugins[
			"agile-obsidian"
		] as unknown;
		this.taskIndex = (plugin as { taskIndex: TaskIndex }).taskIndex;
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

		// Initial render
		await this.updateView();

		// Register events for auto-refresh on vault changes
		this.registerEvent(
			this.app.vault.on("modify", async (file: TFile) => {
				if (file.extension === "md") {
					await this.taskIndex.updateFile(file);
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
		const container = this.containerEl.children[1];
		const contentContainer =
			(container.querySelector(
				".content-container"
			) as HTMLElement | null) ??
			container.createEl("div", { cls: "content-container" });
		contentContainer.empty(); // Clear previous content (keep controls)

		const selectedView = this.viewSelect.value;
		const isActive = this.projectStatusSelect.value === "active";

		if (selectedView === "projects") {
			this.projectView(contentContainer, isActive);
		} else if (selectedView === "deadlines") {
			// Placeholder for deadlineView
			console.log("Deadline view selected (not implemented yet)");
			contentContainer.createEl("h2", {
				text: "❗ Deadlines (Coming Soon)",
			});
		} else if (selectedView === "completed") {
			// Placeholder for completedView
			console.log("Completed view selected (not implemented yet)");
			contentContainer.createEl("h2", {
				text: "✅ Completed (Coming Soon)",
			});
		}
	}

	private projectView(container: HTMLElement, status = true) {
		// Get all tasks from index
		const currentTasks = this.taskIndex.getAllTasks();

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

		// Call each section processor
		processAndRenderObjectives(
			container,
			currentTasks,
			status,
			this.app,
			taskMap,
			childrenMap
		);
		processAndRenderTasks(
			container,
			currentTasks,
			status,
			this.app,
			taskMap,
			childrenMap
		);
		processAndRenderStories(
			container,
			currentTasks,
			status,
			this.app,
			taskMap,
			childrenMap
		);
		processAndRenderEpics(
			container,
			currentTasks,
			status,
			this.app,
			taskMap,
			childrenMap
		);
		processAndRenderInitiatives(
			container,
			currentTasks,
			status,
			this.app,
			taskMap,
			childrenMap
		);
		processAndRenderResponsibilities(
			container,
			currentTasks,
			status,
			this.app,
			taskMap,
			childrenMap
		);
		processAndRenderPriorities(
			container,
			currentTasks,
			status,
			this.app,
			taskMap,
			childrenMap
		);
	}
}
