import { App } from "obsidian";
import { TaskItem, TaskParams } from "@features/task-index";
import { renderTaskTree } from "./task-renderer";
import {
	activeForMember,
	isCancelled,
	isSnoozed,
	getAgileArtifactType,
} from "@features/task-filter";
import { isRelevantToday } from "@features/task-date-manager";
import { buildPrunedMergedTrees } from "@features/task-tree-builder";
import { isShownByParams } from "../utils/filters";
import { attachSectionFolding } from "@features/task-tree-fold";

type RegisterDomEvent = (
	el: HTMLElement | Window | Document,
	type: string,
	handler: (evt: Event) => void,
	options?: AddEventListenerOptions | boolean
) => void;

/**
 * Process and render the Priorities section.
 *
 * New behavior:
 * - Still starts from "priority root" tasks (open, relevant today, non-snoozed, etc.).
 * - Defines the "priority area" as those roots plus all of their nested/deeply nested children.
 * - Within that area, selects only tasks:
 *   - Visible under current TaskParams (isShownByParams);
 *   - Directly assigned/active for the selected member (activeForMember).
 * - Uses buildPrunedMergedTrees to build pruned/merged trees from those tasks.
 * - Clips the merged result back at the original priority roots so we only show
 *   trees rooted at the priority roots (no ancestors above).
 * - Enables folding on those priority trees.
 */
export function processAndRenderPriorities(
	container: HTMLElement,
	currentTasks: TaskItem[],
	status: boolean,
	selectedAlias: string | null,
	app: App,
	taskMap: Map<string, TaskItem>,
	childrenMap: Map<string, TaskItem[]>,
	taskParams: TaskParams,
	registerDomEvent?: RegisterDomEvent
): void {
	const { inProgress, completed, sleeping, cancelled } = taskParams;
	void inProgress;
	void completed;
	void sleeping;
	void cancelled;

	// 1) Identify "priority root" tasks (same top-level criteria as before)
	const priorityRoots = currentTasks.filter(
		(task: TaskItem) =>
			task.status === "O" &&
			!task.completed &&
			isRelevantToday(task) &&
			!isCancelled(task) &&
			!task.text.includes("🎖️") &&
			!task.text.includes("🏆") &&
			!task.text.includes("📝") &&
			!isSnoozed(task, taskMap, selectedAlias) &&
			getAgileArtifactType(task) !== "recurring-responsibility"
	);

	if (priorityRoots.length === 0 || !status) {
		// No priority roots, or inactive view: nothing to render.
		return;
	}

	// 2) Build the "priority area" = all descendants of all priority roots
	const priorityRootIds = new Set<string>();
	for (const root of priorityRoots) {
		if (root._uniqueId) priorityRootIds.add(root._uniqueId);
	}

	const priorityAreaIds = new Set<string>();
	for (const rootId of priorityRootIds) {
		if (!rootId) continue;
		const queue: string[] = [rootId];
		while (queue.length > 0) {
			const id = queue.shift()!;
			if (!id || priorityAreaIds.has(id)) continue;
			priorityAreaIds.add(id);

			const children = childrenMap.get(id) || [];
			for (const child of children) {
				const cid = child._uniqueId;
				if (cid && !priorityAreaIds.has(cid)) {
					queue.push(cid);
				}
			}
		}
	}

	if (priorityAreaIds.size === 0) {
		return;
	}

	// 3) Within the priority area, pick tasks that are visible under current TaskParams
	//    (same visibility logic used by artifacts.ts via isShownByParams)
	const visiblePriorityAreaTasks = currentTasks.filter((task) => {
		const id = task._uniqueId ?? "";
		if (!id) return false;
		if (!priorityAreaIds.has(id)) return false;
		return isShownByParams(task, taskMap, selectedAlias, taskParams);
	});

	// 4) From those, select tasks directly assigned/active for the selected member
	//    (mirrors artifacts.ts behavior for Tasks/Stories/Epics)
	const directPriorityAssigned = visiblePriorityAreaTasks.filter((task) =>
		activeForMember(task, status, selectedAlias)
	);

	if (directPriorityAssigned.length === 0) {
		// No directly assigned tasks under priority roots → nothing to show.
		return;
	}

	// 5) Build pruned/merged trees from the directly-assigned tasks in the priority area.
	//    We pass childrenMap so tree-builder has full child relationships.
	const mergedTrees = buildPrunedMergedTrees(
		directPriorityAssigned,
		taskMap,
		undefined,
		childrenMap
	);

	if (!mergedTrees || mergedTrees.length === 0) {
		return;
	}

	// 6) Clip/anchor the merged result at the original priority roots.
	const rootsById = new Map<string, TaskItem>();

	const collectPriorityRootSubtrees = (node: TaskItem) => {
		const id = node._uniqueId ?? "";
		const isPriorityRoot = id && priorityRootIds.has(id);
		if (isPriorityRoot) {
			if (!rootsById.has(id)) {
				rootsById.set(id, {
					...node,
					children: node.children ? [...node.children] : [],
				});
			}
			return;
		}
		for (const child of node.children || []) {
			collectPriorityRootSubtrees(child);
		}
	};

	for (const tree of mergedTrees) {
		collectPriorityRootSubtrees(tree);
	}

	const orderedPriorityTrees: TaskItem[] = [];
	for (const root of priorityRoots) {
		const id = root._uniqueId ?? "";
		if (!id) continue;
		const tree = rootsById.get(id);
		if (tree) orderedPriorityTrees.push(tree);
	}

	if (orderedPriorityTrees.length === 0) {
		return;
	}

	// 7) Render section with its own root wrapper (similar to artifacts.ts) and enable folding
	const sectionRoot = container.createEl("div", {
		cls: "agile-artifact-section",
		attr: {
			"data-section-root": "priorities",
		},
	});

	// Heading
	sectionRoot.createEl("h2", { text: "📂 priorities overview" });

	// Render pruned priority trees
	renderTaskTree(
		orderedPriorityTrees,
		sectionRoot,
		app,
		0,
		false,
		"priorities",
		selectedAlias
	);

	// Enable folding scoped to this section
	try {
		attachSectionFolding(sectionRoot, {
			app,
			taskMap,
			childrenMap,
			selectedAlias,
			renderTaskTree,
			registerDomEvent,
			sectionName: "priorities",
		});
	} catch {
		/* ignore */
	}

	// Optional: ensure correct data-section stamping within this section, like artifacts.ts
	try {
		const restamp = (rootEl: HTMLElement, value: string) => {
			const uls = Array.from(
				rootEl.querySelectorAll<HTMLElement>(
					"ul.agile-dashboard.contains-task-list"
				)
			);
			uls.forEach((ul) => ul.setAttribute("data-section", value));

			const lis = Array.from(
				rootEl.querySelectorAll<HTMLElement>("li.task-list-item")
			);
			lis.forEach((li) => li.setAttribute("data-section", value));
		};
		restamp(sectionRoot, "priorities");
	} catch {
		/* ignore */
	}
}