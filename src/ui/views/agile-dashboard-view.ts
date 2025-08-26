import { ItemView, WorkspaceLeaf, TFile, TAbstractFile } from "obsidian";
import { TaskIndex } from "src/domain/task-index/task-index";
import { TaskItem } from "src/domain/tasks/task-item";
import manifest from "../../../manifest.json";
import { cleanupExpiredSnoozes } from "../../domain/tasks/snooze/snooze-utils";
import { getCurrentUserDisplayName } from "src/infra/persistence/settings-store";

// Section processors
import { processAndRenderObjectives } from "../sections/objectives-section";
import { processAndRenderTasks } from "../sections/tasks-section";
import { processAndRenderStories } from "../sections/stories-section";
import { processAndRenderEpics } from "../sections/epics-section";
import { processAndRenderInitiatives } from "../sections/initiatives-section";
import { processAndRenderResponsibilities } from "../sections/responsibilities-section";
import { processAndRenderPriorities } from "../sections/priorities-section";
import type AgileObsidianPlugin from "../../main";

export const VIEW_TYPE_AGILE_DASHBOARD = "agile-dashboard-view";

export class AgileDashboardView extends ItemView {
	private taskIndex: TaskIndex;
	private viewSelect: HTMLSelectElement;
	private activeToggle: HTMLInputElement;
	private activeToggleLabel: HTMLSpanElement;
	private memberSelect: HTMLSelectElement;
	private plugin: AgileObsidianPlugin; // New: Store the plugin instance for settings access
	private suppressedFiles = new Set<string>();

	constructor(leaf: WorkspaceLeaf, plugin: AgileObsidianPlugin) {
		// Updated: Accept plugin
		super(leaf);
		this.plugin = plugin; // New: Assign plugin
		this.taskIndex = TaskIndex.getInstance(plugin.app);
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
		strongText.textContent = `Agile Obsidian v${manifest.version}`;

		this.viewSelect = controlsContainer.createEl("select", {
			attr: { style: "margin-right: 10px;" },
		});
		this.viewSelect.innerHTML = `
      <option value="projects">🚀 Projects</option>
      <option value="completed">✅ Completed</option>
    `;

		// Active/Inactive toggle:
		// - When checked (true), the view is "Active".
		// - When unchecked (false), the view is "Inactive".
		// The label below reflects the current state, and the boolean is later passed to projectView as `status`.
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
			const teams = this.plugin.settings.teams || [];
			const seen = new Set<string>();
			for (const t of teams) {
				for (const m of t.members || []) {
					const alias = (m.alias || "").trim();
					const dispName = m.name || alias;
					if (!alias) continue;
					if (seen.has(alias)) continue; // de-duplicate members across teams by alias
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

			const def = this.plugin.settings.currentUserAlias || "";
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

		// New: Listen for settings changes to auto-refresh
		this.registerEvent(
			// @ts-ignore - Suppress type error for custom event (Obsidian typings don't support arbitrary events)
			this.app.workspace.on("agile-settings-changed", () => {
				if (this.memberSelect) {
					const prev = this.memberSelect.value;
					// Repopulate member dropdown and preserve selection if possible
					// populateMemberSelect is defined above in onOpen scope
					// @ts-ignore - using function from closure
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
		// isActive is true when the checkbox is checked ("Active"), false when unchecked ("Inactive").
		const isActive = this.activeToggle ? this.activeToggle.checked : true;
		const selectedAlias =
			this.memberSelect?.value ||
			this.plugin.settings.currentUserAlias ||
			null;

		if (selectedView === "projects") {
			await this.projectView(contentContainer, isActive, selectedAlias);
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

	/**
	 * Render the Projects view.
	 * @param container Target element to render into.
	 * @param status When true => "Active" mode; when false => "Inactive" mode.
	 * @param selectedAlias Alias whose items to emphasize/filter; null means current user or all.
	 */
	private async projectView(
		container: HTMLElement,
		status = true,
		selectedAlias: string | null = null
	) {
		// Get all tasks from index
		let currentTasks = this.taskIndex.getAllTasks();

		// Clean up expired snoozes for current user before rendering
		const changedFiles = await cleanupExpiredSnoozes(
			this.app,
			currentTasks,
			getCurrentUserDisplayName(this.plugin.settings) || ""
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
				selectedAlias,
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
				selectedAlias,
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
				selectedAlias,
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
				selectedAlias,
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
				selectedAlias,
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
				selectedAlias,
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
				selectedAlias,
				this.app,
				taskMap,
				childrenMap,
				taskParams
			);
		}
	}
}
