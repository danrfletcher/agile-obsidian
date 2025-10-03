import { ItemView, WorkspaceLeaf, TFile, TAbstractFile } from "obsidian";
import manifest from "manifest.json";

import { processAndRenderObjectives } from "../components/objectives";
import { processAndRenderArtifacts } from "../components/artifacts";
import { processAndRenderInitiatives } from "../components/initiatives";
import { processAndRenderResponsibilities } from "../components/responsibilities";
import { processAndRenderPriorities } from "../components/priorities";
import { renderTaskTree } from "../components/task-renderer";

import type { TaskItem, TaskIndexService } from "@features/task-index";
import type { SettingsService } from "@settings";
import type { OrgStructurePort } from "@features/org-structure";
import { renderTeamsPopupContent, TeamsPopupContext } from "./teams-popup";

// headless reassignment menu for dashboard
import { openAssignmentMenuAt } from "@features/task-assignment/ui/reassignment-menu";

// NEW: Import the templating handler for parameterized template editing in the dashboard
import { attachDashboardTemplatingHandler } from "../handlers/templating-handler";

export const VIEW_TYPE_AGILE_DASHBOARD = "agile-dashboard-view";

export type AgileDashboardViewPorts = {
	taskIndex?: TaskIndexService;
	settings: SettingsService;
	orgStructure?: OrgStructurePort;
	manifestId?: string;
};

/**
 * Agile Dashboard View
 */
export class AgileDashboardView extends ItemView {
	private taskIndexService: TaskIndexService;
	private settingsService: SettingsService;

	private viewSelect!: HTMLSelectElement;
	private activeToggle!: HTMLInputElement;
	private activeToggleLabel!: HTMLSpanElement;
	private memberSelect!: HTMLSelectElement;
	private suppressedFiles = new Set<string>();

	// Team selection UI
	private orgStructurePort?: OrgStructurePort;
	private selectTeamsBtn: HTMLButtonElement | null = null;
	private teamsPopupEl: HTMLDivElement | null = null;
	private outsideClickHandler: ((ev: MouseEvent) => void) | null = null;

	// Team selection state
	private selectedTeamSlugs: Set<string> = new Set();
	private implicitAllSelected = true;
	private storageKey: string;

	// Track whether we’ve attached the dashboard assignment click handler
	private dashboardAssignHandlerAttached = false;

	constructor(leaf: WorkspaceLeaf, ports: AgileDashboardViewPorts) {
		super(leaf);
		this.settingsService = ports.settings;

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

		this.orgStructurePort = ports.orgStructure;
		const mid = (ports.manifestId || "").trim() || "agile-default";
		this.storageKey = `agile:selected-team-slugs:${mid}`;
		this.loadSelectedTeamSlugs();
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
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();

		// Controls row
		const controlsContainer = container.createEl("div", {
			attr: {
				style: "display:flex; align-items:center; gap:8px; position:relative; flex-wrap:wrap;",
			},
		});

		const versionText = controlsContainer.createEl("p");
		const strongText = versionText.createEl("strong");
		strongText.textContent = `Agile Obsidian v${manifest.version}`;

		this.viewSelect = controlsContainer.createEl("select");
		this.viewSelect.innerHTML = `
      <option value="projects">🚀 Projects</option>
      <option value="completed">✅ Completed</option>
    `;

		// Member dropdown (grouped and sorted)
		this.memberSelect = controlsContainer.createEl("select");
		this.populateMemberSelectGrouped();

		this.memberSelect.addEventListener("change", () => {
			this.restrictSelectedTeamsToUserMembership();
			this.updateView();
			if (this.teamsPopupEl) {
				this.renderTeamsPopup();
			}
		});

		// Select Teams button + popup
		this.selectTeamsBtn = controlsContainer.createEl("button", {
			text: "Select Teams",
		}) as HTMLButtonElement;
		this.selectTeamsBtn.addEventListener("click", (ev) => {
			ev.preventDefault();
			ev.stopPropagation();
			this.toggleTeamsPopup(this.selectTeamsBtn!);
		});

		// Active/Inactive toggle — right next to "Select Teams"
		const statusToggleContainer = controlsContainer.createEl("span", {
			attr: {
				style: "display:inline-flex; align-items:center; gap:6px;",
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

		// Listen for settings changes to auto-refresh
		this.registerEvent(
			// @ts-ignore
			this.app.workspace.on("agile-settings-changed", () => {
				if (this.memberSelect) {
					const prev = this.getSelectedAlias();
					this.populateMemberSelectGrouped();
					const exists = Array.from(this.memberSelect.options).some(
						(o) => o.value === prev
					);
					if (prev && exists) this.memberSelect.value = prev!;
				}
				this.restrictSelectedTeamsToUserMembership();
				this.updateView();
				if (this.teamsPopupEl) this.renderTeamsPopup();
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

		// Listen for assignment changes: FULL view rerender
		this.registerDomEvent(
			window,
			"agile:assignee-changed" as any,
			async (e: Event) => {
				const ev = e as CustomEvent<{
					filePath: string;
					parentLine0: number;
					beforeLines?: string[] | null;
					newAssigneeSlug: string | null;
					oldAssigneeSlug?: string | null;
					parentUid?: string | null;
				}>;
				const filePath = ev.detail?.filePath;

				try {
					if (filePath) {
						this.suppressedFiles.add(filePath);
						const af =
							this.app.vault.getAbstractFileByPath(filePath);
						if (af instanceof TFile) {
							await this.taskIndexService.updateFile(af);
						}
					}
				} catch {
					/* ignore */
				}

				// Rerender entire dashboard (instead of localized subtree refresh)
				await this.updateView();
			}
		);

		// Also respond to the legacy/general event that's dispatched elsewhere
		this.registerDomEvent(
			window,
			"agile:assignment-changed" as any,
			async (e: Event) => {
				const ev = e as CustomEvent<{
					uid: string;
					filePath: string;
					newAlias: string;
				}>;
				const filePath = ev.detail?.filePath;

				try {
					if (filePath) {
						this.suppressedFiles.add(filePath);
						const af =
							this.app.vault.getAbstractFileByPath(filePath);
						if (af instanceof TFile) {
							await this.taskIndexService.updateFile(af);
						}
					}
				} catch {
					/* ignore */
				}

				// Full view rerender to reflect assignment changes across sections
				await this.updateView();
			}
		);

		// NEW: Localized subtree refresh on snooze events (used by 💤 and 💤⬇️)
		// Avoid re-rendering leaf tasks that were optimistically hidden (single-task snooze).
		this.registerDomEvent(
			window,
			"agile:task-snoozed" as any,
			async (e: Event) => {
				try {
					const ev = e as CustomEvent<{
						uid: string;
						filePath?: string;
						date?: string;
					}>;
					const uid = ev?.detail?.uid || "";
					const filePath = ev?.detail?.filePath || "";

					if (!uid) return;

					// If the element for uid is currently hidden (e.g., single-task 💤),
					// skip the refresh to preserve the optimistic disappearance.
					const viewContainer = this.containerEl
						.children[1] as HTMLElement;
					const contentRoot = viewContainer.querySelector(
						".content-container"
					) as HTMLElement | null;

					let targetLi: HTMLElement | null = null;
					if (contentRoot) {
						const allLis = Array.from(
							contentRoot.querySelectorAll("li[data-task-uid]")
						) as HTMLElement[];
						targetLi =
							allLis.find(
								(el) =>
									(el.getAttribute("data-task-uid") || "") ===
									uid
							) || null;
					}

					const isHidden =
						!targetLi ||
						targetLi.style.display === "none" ||
						targetLi.getAttribute("aria-hidden") === "true" ||
						(() => {
							try {
								const cs = getComputedStyle(targetLi!);
								return (
									cs.display === "none" ||
									cs.visibility === "hidden"
								);
							} catch {
								return false;
							}
						})();

					if (isHidden) {
						// Leaf task snooze or already removed: do nothing.
						return;
					}

					// Keep local modify-driven refresh suppressed and update index
					try {
						if (filePath) {
							this.suppressedFiles.add(filePath);
							const af =
								this.app.vault.getAbstractFileByPath(filePath);
							if (af instanceof TFile) {
								await this.taskIndexService.updateFile(af);
							}
						}
					} catch {
						/* ignore */
					}

					// Localized subtree refresh for the updated node (e.g., parent for 💤⬇️)
					await this.refreshTaskTreeByUid(uid);
				} catch {
					/* ignore */
				}
			}
		);

		// Attach dashboard-level click handler for assignment wrappers (once)
		this.attachDashboardAssignmentHandler();

		// NEW: Attach dashboard-level click handler for parameterized template editing
		attachDashboardTemplatingHandler({
			app: this.app,
			viewContainer: container,
			registerDomEvent: this.registerDomEvent.bind(this),
			refreshForFile: this.refreshForFile.bind(this),
		});

		// Initial render
		await this.updateView();

		// Auto-refresh on vault changes
		this.registerEvent(
			this.app.vault.on("modify", async (file: TFile) => {
				if (file.extension === "md") {
					await this.taskIndexService.updateFile(file);
					if (this.suppressedFiles.has(file.path)) {
						this.suppressedFiles.delete(file.path);
						return;
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
						this.taskIndexService.renameFile(oldPath, file.path);
						this.updateView();
					}
				}
			)
		);
	}

	async onClose() {
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

	private attachDashboardAssignmentHandler() {
		if (this.dashboardAssignHandlerAttached) return;
		const viewContainer = this.containerEl.children[1] as HTMLElement;

		// Delegate clicks inside the content container (bubble phase)
		this.registerDomEvent(viewContainer, "click", (evt: MouseEvent) => {
			const tgt = evt.target as HTMLElement | null;
			const span = tgt?.closest(
				'span[data-template-key="members.assignee"]'
			) as HTMLElement | null;
			if (!span) return;

			// Prevent other handlers (checkboxes, links, etc.) only for the assignee span
			evt.preventDefault();
			evt.stopPropagation();
			// @ts-ignore
			(evt as any).stopImmediatePropagation?.();

			try {
				const templateKey =
					span.getAttribute("data-template-key") ?? "";
				if (templateKey !== "members.assignee") return;

				const instanceId =
					span.getAttribute("data-template-wrapper") ?? "";
				if (!instanceId) return;

				const assignTypeAttr = (
					span.getAttribute("data-assign-type") || ""
				).toLowerCase();
				const assignType: "assignee" | "delegate" =
					assignTypeAttr === "delegate" ? "delegate" : "assignee";

				const currentState = (
					(
						span.getAttribute("data-assignment-state") || ""
					).toLowerCase() === "inactive"
						? "inactive"
						: "active"
				) as "active" | "inactive";

				const currentSlug = (
					span.getAttribute("data-member-slug") || ""
				).trim();

				// Map to task LI
				const li = span.closest(
					"li[data-file-path]"
				) as HTMLElement | null;
				const filePath = li?.getAttribute("data-file-path") || "";
				if (!filePath) return;

				const parentUid = li?.getAttribute("data-task-uid") || null;
				const lineHintStr = li?.getAttribute("data-line") || "";
				const lineHint0 =
					lineHintStr && /^\d+$/.test(lineHintStr)
						? parseInt(lineHintStr, 10)
						: null;

				if (!this.orgStructurePort) return;

				openAssignmentMenuAt({
					mode: "headless",
					app: this.app,
					plugin: null,
					ports: { orgStructure: this.orgStructurePort },
					at: { x: evt.clientX, y: evt.clientY },
					filePath,
					instanceId,
					assignType,
					currentState,
					currentSlug,
					parentUid,
					lineHint0,
				});
			} catch (err) {
				console.error("[AgileDashboard] assignment menu error:", err);
			}
		});
		this.dashboardAssignHandlerAttached = true;
	}

	// NEW: Refresh method used by templating handler for double-buffered re-render
	private async refreshForFile(filePath?: string | null) {
		try {
			if (filePath) {
				const af = this.app.vault.getAbstractFileByPath(filePath);
				if (af instanceof TFile) {
					await this.taskIndexService.updateFile(af);
				}
			}
		} catch { /* ignore */ }
		await this.updateView();
	}

	private getSelectedAlias(): string | null {
		return (
			this.memberSelect?.value ||
			this.settingsService.getRaw().currentUserAlias ||
			null
		);
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
		const selectedAlias = this.getSelectedAlias();

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
		if (!this.implicitAllSelected && this.selectedTeamSlugs.size === 0) {
			const msg = container.createEl("div", {
				attr: {
					style: "display:flex; align-items:center; justify-content:center; min-height: 240px; text-align:center; opacity:0.8;",
				},
			});
			msg.createEl("div", {
				text: "No organizations/teams selected. Select a team or organization to view the dashboard",
			});
			return;
		}

		let currentTasks: TaskItem[] = this.taskIndexService.getAllTasks();

		// NOTE: Metadata cleanup (expired snoozes) is now run by the global
		// task-metadata-cleanup module on startup and daily. We do not run it here.

		currentTasks = currentTasks.filter((t) =>
			this.isTaskAllowedByTeam(t as unknown as TaskItem)
		);

		const taskMap = new Map<string, TaskItem>();
		const childrenMap = new Map<string, TaskItem[]>();
		currentTasks.forEach((t) => {
			if (t._uniqueId) {
				taskMap.set(t._uniqueId, t as unknown as TaskItem);
				childrenMap.set(t._uniqueId, []);
			}
		});
		currentTasks.forEach((t) => {
			const tt = t as unknown as TaskItem;
			if (tt._parentId && childrenMap.has(tt._parentId)) {
				childrenMap.get(tt._parentId)!.push(tt);
			}
		});

		const taskParams = {
			inProgress: true,
			completed: false,
			sleeping: false,
			cancelled: false,
		};

		const settings = this.settingsService.getRaw();

		if (settings.showObjectives) {
			processAndRenderObjectives(
				container,
				currentTasks as unknown as TaskItem[],
				status,
				selectedAlias,
				this.app,
				taskMap,
				childrenMap,
				taskParams
			);
		}
		if (settings.showResponsibilities) {
			processAndRenderResponsibilities(
				container,
				currentTasks as unknown as TaskItem[],
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
			currentTasks as unknown as TaskItem[],
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
				currentTasks as unknown as TaskItem[],
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
				currentTasks as unknown as TaskItem[],
				status,
				selectedAlias,
				this.app,
				taskMap,
				childrenMap,
				taskParams
			);
		}
	}

	// Localized re-render: replace just the subtree LI for a given uid
	private async refreshTaskTreeByUid(uid: string) {
		const viewContainer = this.containerEl.children[1] as HTMLElement;
		const contentRoot = viewContainer.querySelector(
			".content-container"
		) as HTMLElement | null;
		if (!contentRoot) return;

		const allLis = Array.from(
			contentRoot.querySelectorAll("li[data-task-uid]")
		) as HTMLElement[];
		const li = allLis.find(
			(el) => (el.getAttribute("data-task-uid") || "") === uid
		);
		if (!li) return;

		const ul = li.closest(
			"ul.agile-dashboard.contains-task-list"
		) as HTMLElement | null;
		const sectionType = ul?.getAttribute("data-section") || "tasks";

		const task = (this.taskIndexService.getById?.(uid) ||
			null) as TaskItem | null;
		if (!task) return;

		const tmp = document.createElement("div");
		renderTaskTree(
			[task],
			tmp,
			this.app,
			0,
			false,
			sectionType,
			this.getSelectedAlias()
		);
		const newLi = tmp.querySelector(
			"ul.agile-dashboard.contains-task-list > li"
		) as HTMLElement | null;
		if (!newLi) return;

		li.replaceWith(newLi);
	}

		// -----------------------
	// Member select (grouped)
	// -----------------------
	private populateMemberSelectGrouped() {
		this.memberSelect.innerHTML = "";

		type Entry = {
			alias: string;
			name: string;
			role: "member" | "internal-team-member" | "team" | "external";
			label: string;
		};
		const entries: Entry[] = [];

		const settings = this.settingsService.getRaw();
		const teams = settings.teams || [];
		const seen = new Set<string>();

		const normalizeAlias = (input: string): string => {
			if (!input) return "";
			let s = String(input).trim();
			if (s.startsWith("@")) s = s.slice(1);
			return s.toLowerCase();
		};

		for (const t of teams) {
			for (const m of t.members || []) {
				const aliasRaw =
					typeof m === "string"
						? m
						: (m as any)?.alias || (m as any)?.name || "";
				const alias = normalizeAlias(aliasRaw);
				if (!alias) continue;
				if (seen.has(alias)) continue;
				seen.add(alias);

				const dispName =
					(typeof m === "string" ? "" : (m as any)?.name) || alias;

				const lower = alias.toLowerCase();
				let role: Entry["role"] = "member";
				if (lower.endsWith("-ext")) role = "external";
				else if (lower.endsWith("-team")) role = "team";
				else if (lower.endsWith("-int")) role = "internal-team-member";

				const roleLabel =
					role === "member"
						? "Team Member"
						: role === "internal-team-member"
						? "Internal Team Member"
						: role === "team"
						? "Internal Team"
						: "External Delegate";
				const label = `${dispName} (${roleLabel} - ${alias})`;

				entries.push({ alias, name: dispName, role, label });
			}
		}

		const groupTeamMembers = entries
			.filter(
				(e) => e.role === "member" || e.role === "internal-team-member"
			)
			.sort((a, b) => a.name.localeCompare(b.name));
		const groupDelegatesInternalTeams = entries
			.filter((e) => e.role === "team")
			.sort((a, b) => a.name.localeCompare(b.name));
		const groupDelegatesExternal = entries
			.filter((e) => e.role === "external")
			.sort((a, b) => a.name.localeCompare(b.name));

		const addGroup = (label: string, group: Entry[]) => {
			if (group.length === 0) return;
			const og = document.createElement("optgroup");
			og.label = label;
			group.forEach((e) => {
				const opt = document.createElement("option");
				opt.value = e.alias;
				opt.text = e.label;
				og.appendChild(opt);
			});
			this.memberSelect.appendChild(og);
		};

		addGroup("Team Members", groupTeamMembers);
		addGroup("Delegates – Internal Teams", groupDelegatesInternalTeams);
		addGroup("Delegates – External", groupDelegatesExternal);

		const defRaw = this.settingsService.getRaw().currentUserAlias || "";
		const def = normalizeAlias(defRaw);
		const all = [
			...groupTeamMembers,
			...groupDelegatesInternalTeams,
			...groupDelegatesExternal,
		];
		if (def && all.some((e) => e.alias === def)) {
			this.memberSelect.value = def;
		} else if (all.length > 0) {
			this.memberSelect.value = all[0].alias;
		}
	}
	private loadSelectedTeamSlugs() {
		try {
			const raw = window.localStorage.getItem(this.storageKey);
			if (raw === null) {
				this.implicitAllSelected = true;
				this.selectedTeamSlugs = new Set();
				return;
			}
			this.implicitAllSelected = false;
			const arr = JSON.parse(raw);
			if (Array.isArray(arr)) {
				this.selectedTeamSlugs = new Set(
					arr.map((s) => String(s).toLowerCase())
				);
			} else {
				this.selectedTeamSlugs = new Set();
			}
		} catch {
			this.implicitAllSelected = true;
			this.selectedTeamSlugs = new Set();
		}
	}
	private persistSelectedTeamSlugs() {
		try {
			this.implicitAllSelected = false;
			const arr = Array.from(this.selectedTeamSlugs.values());
			window.localStorage.setItem(this.storageKey, JSON.stringify(arr));
		} catch {}
	}
	private isTaskAllowedByTeam(task: TaskItem): boolean {
		const filePath =
			task.link?.path || (task._uniqueId?.split(":")[0] ?? "");
		if (!filePath) return false;
		const allowedByUser = this.getAllowedTeamSlugsForSelectedUser();
		if (this.implicitAllSelected) {
			if (!this.orgStructurePort) return true;
			const teamSlug = this.getTeamSlugForFile(filePath);
			if (!allowedByUser) return true;
			if (!teamSlug) return false;
			return allowedByUser.has(teamSlug);
		}
		if (this.selectedTeamSlugs.size === 0) return false;
		const teamSlug = this.getTeamSlugForFile(filePath);
		if (!teamSlug) return false;
		const inSelected = this.selectedTeamSlugs.has(teamSlug);
		if (!inSelected) return false;
		if (allowedByUser) {
			return allowedByUser.has(teamSlug);
		}
		return true;
	}
	private getTeamSlugForFile(filePath: string): string | null {
		try {
			if (!this.orgStructurePort) return null;
			const { team } =
				this.orgStructurePort.getTeamMembersForFile(filePath);
			const slug = (team?.slug || "").toLowerCase().trim();
			return slug || null;
		} catch {
			return null;
		}
	}
	private aliasFromMemberLike(x: unknown): string {
		const normalizeAlias = (input: string): string => {
			if (!input) return "";
			let s = String(input).trim();
			if (s.startsWith("@")) s = s.slice(1);
			return s.toLowerCase();
		};
		if (typeof x === "string") return normalizeAlias(x);
		if (!x || typeof x !== "object") return "";
		const anyObj = x as Record<string, unknown>;
		const cand =
			(anyObj as any).alias ??
			(anyObj as any).user ??
			(anyObj as any).name ??
			(anyObj as any).id ??
			(anyObj as any).email;
		return normalizeAlias(
			typeof cand === "string" ? cand : String(cand || "")
		);
	}
	private extractAliases(members: unknown): string[] {
		if (!members) return [];
		if (Array.isArray(members)) {
			return members
				.map((m) => this.aliasFromMemberLike(m))
				.filter(Boolean);
		}
		if (typeof members === "object") {
			return Object.values(members)
				.map((v) => this.aliasFromMemberLike(v))
				.filter(Boolean);
		}
		return [];
	}
	private teamNodeHasUser(node: any, aliasNorm: string): boolean {
		const pools = [
			node?.members,
			node?.memberAliases,
			node?.users,
			node?.aliases,
			node?.membersMap,
			node?.allMembers,
		];
		for (const pool of pools) {
			const aliases = this.extractAliases(pool);
			if (aliases.includes(aliasNorm)) return true;
		}
		return false;
	}
	private tryPortMembershipMethods(aliasNorm: string): Set<string> | null {
		if (!this.orgStructurePort) return null;
		const port = this.orgStructurePort as unknown as Record<
			string,
			unknown
		>;
		const candidates = [
			"getTeamsForUser",
			"getTeamSlugsForUser",
			"getUserTeams",
			"getTeamsByUser",
		];
		for (const fnName of candidates) {
			const fn = port[fnName];
			if (typeof fn === "function") {
				try {
					const raw = (fn as any).call(
						this.orgStructurePort,
						aliasNorm
					);
					if (Array.isArray(raw)) {
						const set = new Set<string>();
						for (const item of raw) {
							if (typeof item === "string") {
								const slug = item.toLowerCase().trim();
								if (slug) set.add(slug);
							} else if (item && typeof item === "object") {
								const cand =
									(item as any).slug ??
									(item as any).teamSlug ??
									(item as any).id ??
									(item as any).key ??
									(item as any).code;
								const slug =
									typeof cand === "string"
										? cand.toLowerCase().trim()
										: String(cand || "")
												.toLowerCase()
												.trim();
								if (slug) set.add(slug);
							}
						}
						if (set.size > 0) return set;
					}
				} catch {
					/* ignore */
				}
			}
		}
		return null;
	}
	private deriveMembershipFromStructure(
		aliasNorm: string
	): Set<string> | null {
		if (!this.orgStructurePort) return null;
		try {
			const { organizations, teams } =
				this.orgStructurePort.getOrgStructure();
			const result = new Set<string>();
			const visitTeam = (node: any) => {
				const cand =
					node?.slug ??
					node?.teamSlug ??
					node?.id ??
					node?.key ??
					node?.code;
				const slug =
					typeof cand === "string"
						? cand.toLowerCase().trim()
						: String(cand || "")
								.toLowerCase()
								.trim();
				if (slug && this.teamNodeHasUser(node, aliasNorm)) {
					result.add(slug);
				}
				for (const st of (node.subteams as any[] | undefined) || []) {
					visitTeam(st);
				}
			};
			for (const org of organizations || []) {
				for (const t of org.teams || []) visitTeam(t);
			}
			for (const t of teams || []) visitTeam(t);
			return result.size > 0 ? result : new Set<string>();
		} catch {
			return null;
		}
	}
	private deriveMembershipFromSettings(
		aliasNorm: string
	): Set<string> | null {
		try {
			const settings = this.settingsService.getRaw();
			const teams = settings.teams || [];
			const result = new Set<string>();
			for (const t of teams) {
				const slug = (t as any).slug ?? (t as any).teamSlug ?? "";
				const slugNorm = String(slug || "")
					.toLowerCase()
					.trim();
				if (!slugNorm) continue;
				const members = (t as any).members || [];
				const aliases = this.extractAliases(members);
				if (aliases.includes(aliasNorm)) result.add(slugNorm);
			}
			return result.size > 0 ? result : new Set<string>();
		} catch {
			return null;
		}
	}
	private getAllowedTeamSlugsForSelectedUser(): Set<string> | null {
		const normalizeAlias = (input: string): string => {
			if (!input) return "";
			let s = String(input).trim();
			if (s.startsWith("@")) s = s.slice(1);
			return s.toLowerCase();
		};
		const aliasNorm = normalizeAlias(this.getSelectedAlias() || "");
		if (!aliasNorm) return null;
		const fromPortMethods = this.tryPortMembershipMethods(aliasNorm);
		const fromStructure = this.deriveMembershipFromStructure(aliasNorm);
		const fromSettings = this.deriveMembershipFromSettings(aliasNorm);
		const union = new Set<string>();
		for (const s of [fromPortMethods, fromStructure, fromSettings]) {
			if (!s) continue;
			for (const x of s) union.add(x);
		}
		return union.size > 0 ? union : null;
	}
	private restrictSelectedTeamsToUserMembership() {
		const allowed = this.getAllowedTeamSlugsForSelectedUser();
		if (!allowed) return;
		if (this.selectedTeamSlugs.size === 0) return;
		const before = this.selectedTeamSlugs.size;
		for (const s of Array.from(this.selectedTeamSlugs)) {
			if (!allowed.has(s)) {
				this.selectedTeamSlugs.delete(s);
			}
		}
		if (this.selectedTeamSlugs.size !== before) {
			this.persistSelectedTeamSlugs();
		}
	}
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
			orgStructurePort: this.orgStructurePort,
			selectedTeamSlugs: this.selectedTeamSlugs,
			implicitAllSelected: this.implicitAllSelected,
			setImplicitAllSelected: (val: boolean) => {
				this.implicitAllSelected = val;
			},
			addSelectedSlugs: (slugs: string[]) => {
				slugs.forEach((s) =>
					this.selectedTeamSlugs.add((s || "").toLowerCase())
				);
				this.persistSelectedTeamSlugs();
			},
			removeSelectedSlugs: (slugs: string[]) => {
				slugs.forEach((s) =>
					this.selectedTeamSlugs.delete((s || "").toLowerCase())
				);
				this.persistSelectedTeamSlugs();
			},
			onSelectionChanged: () => {
				this.renderTeamsPopup();
				this.updateView();
			},
			getAllowedTeamSlugsForSelectedUser: () =>
				this.getAllowedTeamSlugsForSelectedUser(),
		};
		renderTeamsPopupContent(ctx);
	}
}