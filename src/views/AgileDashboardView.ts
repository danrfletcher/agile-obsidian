import { ItemView, WorkspaceLeaf, TFile, TAbstractFile } from "obsidian";
import { TaskIndex } from "../index/TaskIndex"; // Adjust path if needed
import { renderTaskTree } from "../components/TaskRenderer"; // Adjust path if needed
import { TaskItem } from "../types/TaskItem"; // Adjust path if needed
import {
	isCancelled,
	activeForMember,
	isAssignedToAnyUser,
	isRelevantToday,
	isSleeping,
	isAssignedToMemberOrTeam,
	teamMemberName,
} from "../utils/taskFilters"; // Adjust path if needed
import {
	findAncestor,
	buildFullSubtree,
	getTopAncestor,
	getPathToAncestor,
	buildHierarchyFromPath,
	deepClone,
} from "../utils/hierarchyUtils"; // Adjust path if needed
import {
	getTaskType,
	isLearningInitiative,
	isLearningEpic,
	isOKR,
	isRecurringResponsibility,
} from "../utils/taskTypes"; // Adjust path if needed
import { matchesDatePattern } from "../utils/dateUtils"; // Added missing import
import { version } from "../utils/config";

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
		// Get all tasks from index (flattened like currentTasks)
		const currentTasks = this.taskIndex.getAllTasks();

		// Build taskMap and childrenMap (from original)
		const taskMap = new Map<string, TaskItem>();
		const childrenMap = new Map<string, TaskItem[]>();
		currentTasks.forEach((t) => {
			if (t._uniqueId) {
				// Guard for undefined
				taskMap.set(t._uniqueId, t);
				childrenMap.set(t._uniqueId, []);
			}
		});
		currentTasks.forEach((t) => {
			if (t._parentId && childrenMap.has(t._parentId)) {
				childrenMap.get(t._parentId)?.push(t); // Safe optional chaining
			}
		});

		// Common type checks (from original)
		const isInitiative = (t: TaskItem) =>
			t && (t.text.includes("🎖️") || isLearningInitiative(t));
		const isEpic = (t: TaskItem) =>
			t && (t.text.includes("🏆") || isLearningEpic(t));
		const isStory = (t: TaskItem) => t && t.text.includes("📝");

		// Direct-assignment filter (from original)
		const isDirectlyAssigned = (task: TaskItem) =>
			activeForMember(task, status) &&
			!task.completed &&
			isRelevantToday(task) &&
			!isCancelled(task);

		// OKR Processing (adapted from original)
		const assignedOKRs = currentTasks.filter(
			(task) =>
				isOKR(task) &&
				activeForMember(task, status) &&
				!task.completed &&
				!isCancelled(task) &&
				task.status !== "-" &&
				isRelevantToday(task)
		);
		const assignedOKRSet = new Set(
			assignedOKRs.map((t) => t._uniqueId ?? "")
		); // Use '' as default

		const findLinkedOKRs = (okrSet: Set<string>) => {
			const linkedOKRs: {
				sourceOKR: TaskItem;
				linkedTrees: TaskItem[];
			}[] = [];
			Array.from(okrSet).forEach((okrId) => {
				const okrTask = taskMap.get(okrId);
				if (!okrTask) return;

				const codeMatch = okrTask.text.match(/\^([A-Za-z0-9]{6})$/);
				if (!codeMatch) return;
				const sixDigitCode = codeMatch[1];
				const linkedPattern = new RegExp(`${sixDigitCode}">🔗🎯`);

				const rawLinked = currentTasks.filter((t) =>
					linkedPattern.test(t.text)
				);
				if (!rawLinked.length) return;

				const rootsMap = new Map<string, TaskItem[]>();
				rawLinked.forEach((linkedTask) => {
					const root = getTopAncestor(linkedTask);
					if (!root || !root._uniqueId) return; // Guard
					if (!rootsMap.has(root._uniqueId)) {
						rootsMap.set(root._uniqueId, []);
					}
					rootsMap.get(root._uniqueId)?.push(linkedTask); // Safe optional chaining
				});

				const clonedLinkedTrees: TaskItem[] = [];
				rootsMap.forEach((linkedTasksInRoot, rootId) => {
					const originalRoot = taskMap.get(rootId);
					if (!originalRoot) return;
					const clonedRoot = deepClone(
						buildFullSubtree(originalRoot)
					);

					const pruneToLinked = (node: TaskItem): TaskItem | null => {
						if (!node) return null;
						const prunedChildren = (node.children || [])
							.map(pruneToLinked)
							.filter(Boolean) as TaskItem[];
						const isLinked = linkedTasksInRoot.some(
							(lt) => lt._uniqueId === node._uniqueId
						);
						if (isLinked) {
							node.status = "p";
							node.checked = true;
							node.completed = false;
						}
						if (isLinked || prunedChildren.length > 0) {
							prunedChildren.forEach((child) => {
								child.parent = node.line;
								child._parentId = node._uniqueId ?? ""; // Default
							});
							return { ...node, children: prunedChildren };
						}
						return null;
					};

					const prunedClonedRoot = pruneToLinked(clonedRoot);
					if (prunedClonedRoot)
						clonedLinkedTrees.push(prunedClonedRoot);
				});

				if (clonedLinkedTrees.length > 0) {
					linkedOKRs.push({
						sourceOKR: okrTask,
						linkedTrees: clonedLinkedTrees,
					});
				}
			});
			return linkedOKRs;
		};

		const linkedOKRs = findLinkedOKRs(assignedOKRSet);

		const okrRoots = Array.from(
			new Set(
				assignedOKRs.map(getTopAncestor).map((t) => t._uniqueId ?? "")
			)
		)
			.map((id) => taskMap.get(id))
			.filter((t): t is TaskItem => !!t); // Filter undefined

		const buildOKRSubtree = (
			node: TaskItem,
			isOKRNode = false
		): TaskItem | null => {
			const children = childrenMap.get(node._uniqueId ?? "") || []; // Default
			const isAssignedOKR = assignedOKRSet.has(node._uniqueId ?? "");
			if (isAssignedOKR) isOKRNode = true;

			if (isOKRNode) {
				let processedChildren = children
					.map((child) => buildOKRSubtree(child, true))
					.filter(Boolean) as TaskItem[];

				if (isAssignedOKR) {
					const linkedEntry = linkedOKRs.find(
						(entry) => entry.sourceOKR._uniqueId === node._uniqueId
					);
					if (linkedEntry && linkedEntry.linkedTrees.length > 0) {
						const blankTask: TaskItem = {
							checked: true,
							completed: false,
							fullyCompleted: false,
							text: "‎🔗",
							visual: "‎🔗",
							line: -1,
							lineCount: 1,
							position: {
								start: { line: 0, col: 0, offset: 0 },
								end: { line: 0, col: 0, offset: 0 },
							},
							children: [],
							task: false,
							annotated: false,
							parent: -1,
							blockId: undefined,
							header: {
								link: {
									path: "",
									display: "",
									embed: false,
									subpath: "",
								},
								level: 0,
							},
							status: "O",
							link: {
								path: "",
								display: "",
								embed: false,
								subpath: "",
							},
						};
						processedChildren.push(blankTask);
						linkedEntry.linkedTrees.forEach((tree) => {
							tree.parent = node.line;
							tree._parentId = node._uniqueId ?? "";
						});
						processedChildren = processedChildren.concat(
							linkedEntry.linkedTrees
						);
					}
				}
				return { ...node, children: processedChildren };
			} else {
				const filteredChildren = children
					.map((child) => buildOKRSubtree(child, false))
					.filter(Boolean) as TaskItem[];
				if (isAssignedOKR || filteredChildren.length) {
					return { ...node, children: filteredChildren };
				}
				return null;
			}
		};

		const prunedOKRs = okrRoots
			.map((root) => buildOKRSubtree(root))
			.filter((root): root is TaskItem => root !== null);

		// Parent Finders (from original)
		const parentFinders = [
			{
				finder: (t: TaskItem) => findAncestor(t, isInitiative),
				label: "initiative",
				typeCheck: isInitiative,
			},
			{
				finder: (t: TaskItem) => findAncestor(t, isEpic),
				label: "epic",
				typeCheck: isEpic,
			},
			{
				finder: (t: TaskItem) => findAncestor(t, isStory),
				label: "story",
				typeCheck: isStory,
			},
		];

		// Process Tasks, Stories, Epics (from original)
		const prunedTasks = this.processTaskType(
			(task: TaskItem) =>
				isDirectlyAssigned(task) &&
				!isInitiative(task) &&
				!isEpic(task) &&
				!isStory(task) &&
				!isOKR(task) &&
				!isSleeping(task) &&
				task.status !== "O" &&
				task.status !== "d" &&
				task.status !== "A",
			parentFinders
		);
		const prunedStories = this.processTaskType(
			(task: TaskItem) =>
				isDirectlyAssigned(task) &&
				!isSleeping(task) &&
				getTaskType(task) === "story",
			parentFinders.slice(0, 2)
		);
		const prunedEpics = this.processTaskType(
			(task: TaskItem) =>
				isDirectlyAssigned(task) &&
				!isSleeping(task) &&
				getTaskType(task) === "epic",
			parentFinders.slice(0, 1)
		);

		// Responsibilities (from original)
		const isAssignedToMemberIncludingInferred = (task: TaskItem) => {
			if (isAssignedToMemberOrTeam(task)) return true;
			let cur: TaskItem | undefined = task;
			while (cur?._parentId) {
				const parentId = cur._parentId;
				if (!parentId) return false; // Guard
				cur = taskMap.get(parentId);
				if (!cur) return false;
				if (isAssignedToAnyUser(cur)) {
					return activeForMember(cur);
				}
			}
			return false;
		};

		const collectRecurring = (node: TaskItem, collector: TaskItem[]) => {
			if (
				isRecurringResponsibility(node) &&
				isAssignedToMemberIncludingInferred(node) &&
				!isSleeping(node)
			) {
				collector.push(node);
			}
			(node.children || []).forEach((child) =>
				collectRecurring(child, collector)
			);
		};

		const buildResponsibilitySubtree = (
			task: TaskItem,
			isRoot = false
		): TaskItem | null => {
			if (isSleeping(task)) return null;

			const allowedMarkers = [
				"🚀",
				"📦",
				"⚡",
				"⭐",
				"💝",
				"🔁",
				"⬇️",
				"🪣",
			];
			const disallowedMarkers = ["❌", "🛠️", "📂", "🏆", "📝", "🎖️"];

			if (disallowedMarkers.some((m) => task.text.includes(m)))
				return null;

			if (isLearningInitiative(task) || isLearningEpic(task)) return null;

			const hasAllowedMarker = allowedMarkers.some((m) =>
				task.text.includes(m)
			);
			const hasAllowedStatus = task.status === "d" || task.status === "A";

			if (!isRoot && !hasAllowedMarker && !hasAllowedStatus) return null;

			const children = (task.children || [])
				.map((child) => buildResponsibilitySubtree(child, false))
				.filter((c): c is TaskItem => c !== null);

			if (task.task === false) {
				return children.length > 0 ? { ...task, children } : null;
			}

			const hasAllowed = hasAllowedMarker || hasAllowedStatus;
			const assignedToMeOrTeam = isAssignedToMemberOrTeam(task);
			if (!hasAllowed && children.length === 0 && !assignedToMeOrTeam) {
				return null;
			}

			return { ...task, children };
		};

		const pruneToTargets = (
			node: TaskItem,
			targetIds: Set<string>,
			isUnderTarget = false
		): TaskItem | null => {
			if (!node) return null;

			const thisIsTarget = targetIds.has(node._uniqueId ?? "");
			const effectiveUnder = isUnderTarget || thisIsTarget;

			const prunedChildren = (node.children || [])
				.map((child) =>
					pruneToTargets(child, targetIds, effectiveUnder)
				)
				.filter((c): c is TaskItem => c !== null);

			if (effectiveUnder || prunedChildren.length > 0) {
				return { ...node, children: prunedChildren };
			}
			return null;
		};

		const trimUnassignedAncestors = (tree: TaskItem): TaskItem | null => {
			let current = tree;
			while (
				current &&
				current.children &&
				current.children.length === 1 &&
				!isAssignedToMemberIncludingInferred(current)
			) {
				current = current.children[0];
			}
			return current;
		};

		const priorityRoots = currentTasks.filter(
			(task) =>
				task.status === "O" &&
				!task.completed &&
				isRelevantToday(task) &&
				!isCancelled(task) &&
				!task.text.includes("🎖️") &&
				!task.text.includes("🏆") &&
				!task.text.includes("📝") &&
				!isSleeping(task) &&
				!isRecurringResponsibility(task)
		);

		const priorityTrees = priorityRoots.map(buildFullSubtree);

		let allRecurring: TaskItem[] = [];
		priorityTrees.forEach((tree) => collectRecurring(tree, allRecurring));

		allRecurring = allRecurring.filter(
			(task) => !/🗓️/.test(task.text) || matchesDatePattern(task)
		);

		const recurringWithSubtrees = allRecurring
			.map((rec) => {
				const subtree = buildResponsibilitySubtree(rec);
				return subtree ? { root: rec, subtree } : null;
			})
			.filter(
				(item): item is { root: TaskItem; subtree: TaskItem } =>
					item !== null
			);

		const responsibilityTreesMap = new Map<string, TaskItem>();
		recurringWithSubtrees.forEach(({ root: rec, subtree }) => {
			const topAncestorId = getTopAncestor(rec)._uniqueId ?? "";
			const path = getPathToAncestor(rec, topAncestorId);
			if (!path.length) return;

			const tree = buildHierarchyFromPath(path);
			if (!tree) return;

			let current = tree;
			for (let i = 1; i < path.length; i++) {
				current = current.children[0];
			}
			current.children = subtree.children || [];

			const prunedTree = pruneToTargets(
				tree,
				new Set([rec._uniqueId ?? ""])
			);
			if (!prunedTree) return;

			const trimmedTree = trimUnassignedAncestors(prunedTree);
			if (!trimmedTree) return;

			const rootId = trimmedTree._uniqueId ?? "";
			if (!responsibilityTreesMap.has(rootId)) {
				responsibilityTreesMap.set(rootId, trimmedTree);
			} else {
				const existing = responsibilityTreesMap.get(rootId);
				if (!existing) return; // Guard against undefined
				trimmedTree.children.forEach((newChild) => {
					const match = existing.children.find(
						(c) => c._uniqueId === newChild._uniqueId
					);
					if (match) {
						match.children = [
							...new Set([
								...match.children,
								...newChild.children,
							]),
						];
					} else {
						existing.children.push(newChild);
					}
				});
			}
		});

		const responsibilityTasks = Array.from(responsibilityTreesMap.values());

		// Priorities (from original)
		const buildPriorityTree = (
			task: TaskItem,
			isRoot = false
		): TaskItem | null => {
			if (isSleeping(task)) return null;

			const allowedMarkers = ["🚀", "📦", "⚡", "⭐", "💝", "⬇️", "🪣"];
			const disallowedMarkers = ["❌", "🛠️", "📂", "🏆", "📝", "🎖️"];

			if (disallowedMarkers.some((m) => task.text.includes(m)))
				return null;

			if (isLearningInitiative(task) || isLearningEpic(task)) return null;

			const hasAllowedMarker = allowedMarkers.some((m) =>
				task.text.includes(m)
			);
			const hasAllowedStatus = task.status === "d" || task.status === "A";

			if (!isRoot && !hasAllowedMarker && !hasAllowedStatus) return null;

			const children = (task.children || [])
				.map((child) => buildPriorityTree(child, false))
				.filter((c): c is TaskItem => c !== null);

			if (task.task === false) {
				return children.length > 0 ? { ...task, children } : null;
			}

			const hasAllowed = hasAllowedMarker || hasAllowedStatus;
			const assignedToMe = activeForMember(task);
			if (!hasAllowed && children.length === 0 && !assignedToMe) {
				return null;
			}

			return { ...task, children };
		};

		const rawTreesPriorities = priorityRoots
			.map((task) => buildPriorityTree(task, true))
			.filter((tree): tree is TaskItem => tree !== null);

		const prunePriorities = (
			node: TaskItem,
			inherited = false
		): TaskItem | null => {
			const m = node.text.match(/active-([^"\s]+)/);
			const assignedToMe = m?.[1] === teamMemberName;
			const isInherited = inherited || assignedToMe;
			const children = (node.children || [])
				.map((child) => prunePriorities(child, isInherited))
				.filter((c): c is TaskItem => c !== null);
			if (isInherited || children.length > 0) {
				return { ...node, children };
			}
			return null;
		};

		const priorityTasks = rawTreesPriorities
			.map((tree) => prunePriorities(tree))
			.filter((tree): tree is TaskItem => tree !== null)
			.filter((tree) => {
				const m = tree.text.match(/active-([^"\s]+)/);
				const isMe = m?.[1] === teamMemberName;
				return isMe || (tree.children?.length ?? 0) > 0; // Safe default
			});

		// Initiatives (from original)
		const categorizeEpic = (epic: TaskItem) => {
			if (
				new RegExp(
					`class="(?:in)?active-(?!${teamMemberName})[^"]*"`
				).test(epic.text)
			)
				return "delegated";
			if (epic.text.includes(">⛔")) return "blocked";
			if (epic.text.includes(">⌛")) return "waiting";
			if (epic.text.includes(">🕒")) return "pending";
			if (epic.status === "/") return "inProgress";
			if (epic.status === " ") return "todo";
			return "other";
		};

		const ownInitiatives = currentTasks
			.filter(
				(task) => task.text && isInitiative(task) && !isSleeping(task)
			)
			.map((initiative) => {
				const epics = (
					childrenMap.get(initiative._uniqueId ?? "") || []
				) // Default
					.filter(
						(ep) => isEpic(ep) && !ep.completed && !isCancelled(ep)
					);
				const buckets: { [key: string]: TaskItem[] } = {
					inProgress: [],
					todo: [],
					blocked: [],
					waiting: [],
					pending: [],
					delegated: [],
					other: [],
				};
				epics
					.filter((ep) => !isSleeping(ep))
					.forEach((ep) => {
						const cat = categorizeEpic(ep);
						buckets[cat].push({ ...ep, children: [] });
					});
				const sorted: TaskItem[] = [];
				[
					"inProgress",
					"todo",
					"blocked",
					"waiting",
					"pending",
					"delegated",
					"other",
				].forEach((cat) => {
					if (buckets[cat].length) {
						if (cat !== "todo") sorted.push(...buckets[cat]);
					}
				});
				return { ...initiative, children: sorted };
			})
			.filter(
				(task) =>
					isInitiative(task) &&
					activeForMember(task, status) &&
					!task.completed &&
					isRelevantToday(task)
			)
			.sort((a, b) => {
				const aIsLearning = isLearningInitiative(a);
				const bIsLearning = isLearningInitiative(b);
				if (aIsLearning && !bIsLearning) return 1;
				if (!aIsLearning && bIsLearning) return -1;
				return 0;
			});

		// Render sections (from original)
		this.renderSection(
			"🎯 Objectives",
			prunedOKRs,
			container,
			"objectives"
		);
		this.renderSection("🔨 Tasks", prunedTasks, container, "tasks");
		this.renderSection("📝 Stories", prunedStories, container, "stories");
		this.renderSection("🏆 Epics", prunedEpics, container, "epics");
		this.renderSection(
			"🎖️ Initiatives",
			ownInitiatives,
			container,
			"initiatives"
		);
		this.renderSection(
			"🧹 Responsibilities",
			responsibilityTasks,
			container,
			"responsibilities"
		);
		this.renderSection(
			"📂 Priorities",
			priorityTasks,
			container,
			"priorities"
		);
	}

	private renderSection(
		title: string,
		tasks: TaskItem[],
		container: HTMLElement,
		sectionType: string
	) {
		if (tasks.length) {
			container.createEl("h2", { text: title });
			renderTaskTree(tasks, container, this.app, 0, false, sectionType);
		}
	}

	// Full implementation of processTaskType (adapted from original DataviewJS)
	private processTaskType(
		filter: (task: TaskItem) => boolean,
		parentFinders: {
			finder: (t: TaskItem) => TaskItem | null;
			label: string;
			typeCheck: (t: TaskItem) => boolean;
		}[]
	): TaskItem[] {
		const currentTasks = this.taskIndex.getAllTasks();
		const taskMap = new Map<string, TaskItem>();
		currentTasks.forEach((t) => {
			if (t._uniqueId) {
				taskMap.set(t._uniqueId, t);
			}
		});

		// Filter direct tasks
		const directTasks = currentTasks.filter(filter);

		// Collect unique roots by tracing ancestors using parent finders
		const rootSet = new Set<string>();
		directTasks.forEach((task) => {
			let current = task;
			for (const { finder } of parentFinders) {
				const ancestor = finder(current);
				if (ancestor && ancestor._uniqueId) {
					current = ancestor;
				} else {
					break;
				}
			}
			if (current._uniqueId) {
				rootSet.add(current._uniqueId);
			}
		});

		// Build full subtrees for each root
		const roots = Array.from(rootSet)
			.map((id) => taskMap.get(id))
			.filter((t): t is TaskItem => !!t)
			.map(buildFullSubtree);

		// Prune subtrees to only include relevant paths
		const pruneSubtree = (
			node: TaskItem,
			level: number
		): TaskItem | null => {
			if (level >= parentFinders.length) {
				return filter(node) ? { ...node, children: [] } : null;
			}

			const children = (node.children || [])
				.map((child) => pruneSubtree(child, level))
				.filter((c): c is TaskItem => c !== null);

			const isRelevant =
				parentFinders[level].typeCheck(node) || children.length > 0;
			return isRelevant ? { ...node, children } : null;
		};

		const prunedRoots = roots
			.map((root) => pruneSubtree(root, 0))
			.filter((root): root is TaskItem => root !== null);

		// Sort or further process if needed (e.g., by priority or name)
		prunedRoots.sort((a, b) => a.text.localeCompare(b.text));

		return prunedRoots;
	}
}
