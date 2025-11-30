import { TaskItem } from "@features/task-index";
import { attachFilteredChildren } from "./top-down-builder";
import { bumpWhitelistedListItems } from "./task-tree-utils";

const cloneTaskNode = (obj: TaskItem): TaskItem => ({
	...obj,
	children: Array.isArray(obj.children)
		? obj.children.map((child) => cloneTaskNode(child))
		: obj.children,
});

/**
 * Climbs the task hierarchy from the given task to find the first ancestor that matches the provided predicate.
 * Uses parent IDs and the taskMap to traverse upwards. If no predicate is provided, returns the top ancestor (root).
 * Useful for identifying higher-level parents like initiatives or epics in task trees - e.g. in parentFinders for structuring views like projectView or OKR linked trees.
 * Mutation: none (pure).
 * @param {TaskItem} task - The starting task to climb from.
 * @param {Map<string, TaskItem>} taskMap - Map of unique task IDs to TaskItems for parent lookups.
 * @param {(t: TaskItem) => boolean} [predicate] - A function that returns true for the desired ancestor (defaults to checking for root: t.parent < 0).
 * @returns {TaskItem | null} The matching ancestor (or the task itself if it matches), or null if no ancestor found.
 */
export const findAncestor = (
	task: TaskItem,
	taskMap: Map<string, TaskItem>,
	predicate: (t: TaskItem) => boolean = (t: TaskItem) =>
		typeof t.parent === "number" && t.parent < 0
): TaskItem | null => {
	if (!task) return null;
	if (predicate(task)) return task;
	let current: TaskItem | undefined = task;
	while (current && current._parentId) {
		const next = taskMap.get(current._parentId);
		if (!next) break;
		current = next;
		if (predicate(current)) return current;
	}
	return null;
};

/**
 * Builds an array representing the path from the given task to a specific ancestor (inclusive).
 * Traverses upwards using parent IDs and taskMap; returns [] if no path found.
 * Path is ancestor-first (i.e., path[0] is the ancestor, path[path.length-1] is the starting task).
 * Mutation: none (pure).
 * @param {TaskItem} task - The starting task.
 * @param {string} ancestorId - The unique ID of the target ancestor.
 * @param {Map<string, TaskItem>} taskMap - Map of unique task IDs to TaskItems for parent lookups.
 * @returns {TaskItem[]} The path as an array of tasks, from ancestor to starting task. Empty if the ancestor is not found along the chain.
 */
export const getPathToAncestor = (
	task: TaskItem,
	ancestorId: string,
	taskMap: Map<string, TaskItem>
): TaskItem[] => {
	if (!task || !ancestorId) return [];
	const upward: TaskItem[] = [];
	let current: TaskItem | undefined = task;
	while (current) {
		upward.push(current);
		if (current._uniqueId === ancestorId) break;
		if (!current._parentId) return [];
		current = taskMap.get(current._parentId);
		if (!current) return [];
	}
	if (upward.length === 0) return [];
	return upward.reverse();
};

/**
 * Constructs a hierarchical tree structure from a flat path array (ancestor -> ... -> descendant).
 * Each node in the path becomes a parent-child chain.
 * Mutation: none (pure) for inputs; returns a new tree.
 * @param {TaskItem[]} path - The array of tasks representing the path (ancestor first).
 * @returns {TaskItem | null} The root of the built hierarchy, or null if path is empty.
 */
export const buildHierarchyFromPath = (path: TaskItem[]): TaskItem | null => {
	if (!path.length) return null;
	const root: TaskItem = { ...path[0], children: [] };
	let cursor: TaskItem = root;
	for (let i = 1; i < path.length; i++) {
		const child: TaskItem = { ...path[i], children: [] };
		cursor.children = [child];
		cursor = child;
	}
	return root;
};

/**
 * Recursively merges two task trees by combining children based on _uniqueId.
 * If nodes match by _uniqueId, their children are merged; otherwise, no-op.
 * Mutation: modifies 'target' in place. Children added are cloned to avoid sharing references.
 * @param {TaskItem} target - The base tree to merge into (modified in place).
 * @param {TaskItem} source - The tree to merge from.
 * @returns {void}
 */
export const mergeTaskTrees = (target: TaskItem, source: TaskItem): void => {
	if (!target || !source) return;
	if (target._uniqueId !== source._uniqueId) return;

	const srcKids = Array.isArray(source.children) ? source.children : [];
	const tgtKids = Array.isArray(target.children)
		? target.children
		: (target.children = []);

	for (const srcChild of srcKids) {
		const id = srcChild._uniqueId;
		const match = id ? tgtKids.find((t) => t._uniqueId === id) : undefined;
		if (match) {
			mergeTaskTrees(match, srcChild);
		} else {
			tgtKids.push(cloneTaskNode(srcChild));
		}
	}
};

/**
 * Pure variant: returns a new merged tree without mutating inputs.
 * If roots differ, returns a clone of 'target' unchanged.
 * Mutation: none (pure).
 */
export const mergeTaskTreesPure = (
	target: TaskItem,
	source: TaskItem
): TaskItem => {
	if (!target) return cloneTaskNode(source);
	if (!source) return cloneTaskNode(target);
	if (target._uniqueId !== source._uniqueId) return cloneTaskNode(target);

	const targetChildren = Array.isArray(target.children)
		? target.children
		: [];
	const sourceChildren = Array.isArray(source.children)
		? source.children
		: [];
	const tgtById = new Map<string, TaskItem>();
	for (const c of targetChildren) {
		if (c._uniqueId) tgtById.set(c._uniqueId, c);
	}

	const outChildren: TaskItem[] = [];
	for (const s of sourceChildren) {
		if (!s._uniqueId) {
			outChildren.push(cloneTaskNode(s));
			continue;
		}
		const t = tgtById.get(s._uniqueId);
		if (t) {
			outChildren.push(mergeTaskTreesPure(t, s));
			tgtById.delete(s._uniqueId);
		} else {
			outChildren.push(cloneTaskNode(s));
		}
	}
	for (const t of tgtById.values()) {
		outChildren.push(cloneTaskNode(t));
	}

	return { ...target, children: outChildren };
};

/**
 * Builds pruned and merged task trees from a list of linked tasks.
 * For each linked task: finds the top ancestor (or matching via optional predicate), builds the path, creates a pruned hierarchy, optionally attaches filtered children, and merges overlaps by root.
 * At the end, whitelisted list header items (e.g. NALAp priority headers) are
 * "bumped" so that their children appear directly under the parent instead of
 * showing the header node itself.
 *
 * Mutation: uses in-place merge and in-place child attachment inside the function; returns new cleaned trees array.
 * @param {TaskItem[]} tasks - The array of tasks to build pruned trees from.
 * @param {Map<string, TaskItem>} taskMap - Map of unique task IDs to TaskItems for parent lookups.
 * @param {(t: TaskItem) => boolean} [ancestorPredicate] - Optional predicate for findAncestor (defaults to root: t.parent < 0).
 * @param {Map<string, TaskItem[]>} [childrenMap] - Optional map of task IDs to their direct children (required if using childParams for attachment).
 * @param {{ depth: number; filterCallback?: (t: TaskItem) => boolean } | undefined} [childParams] - Optional params for attaching filtered children (defaults to depth 0: no children).
 * @returns {TaskItem[]} The array of merged, pruned trees (one per unique root).
 */
export const buildPrunedMergedTrees = (
	tasks: TaskItem[],
	taskMap: Map<string, TaskItem>,
	ancestorPredicate?: (t: TaskItem) => boolean,
	childrenMap?: Map<string, TaskItem[]>,
	childParams?: { depth: number; filterCallback?: (t: TaskItem) => boolean }
): TaskItem[] => {
	const treesByRoot = new Map<string, TaskItem>();

	for (const linkedTask of tasks || []) {
		if (!linkedTask || !linkedTask._uniqueId) continue;

		const root = findAncestor(linkedTask, taskMap, ancestorPredicate);
		if (!root || !root._uniqueId) continue;

		const path = getPathToAncestor(linkedTask, root._uniqueId, taskMap);
		if (path.length === 0) continue;

		const prunedTree = buildHierarchyFromPath(path);
		if (!prunedTree) continue;

		// Optionally attach filtered children to the specific linked node within this pruned tree
		if (childParams && childrenMap) {
			const findLinkedNode = (node: TaskItem): TaskItem | null => {
				if (node._uniqueId === linkedTask._uniqueId) return node;
				for (const child of node.children || []) {
					const found = findLinkedNode(child);
					if (found) return found;
				}
				return null;
			};
			const linkedNode = findLinkedNode(prunedTree);
			if (linkedNode) {
				attachFilteredChildren(
					linkedNode,
					childParams.depth,
					childParams.filterCallback,
					childrenMap
				);
			}
		}

		const rootId = root._uniqueId;
		if (!treesByRoot.has(rootId)) {
			treesByRoot.set(rootId, { ...root, children: [] });
		}
		const existingTree = treesByRoot.get(rootId)!;
		// In-place merge so the accumulator updates
		mergeTaskTrees(existingTree, prunedTree);
	}

	const cleanedTrees = Array.from(treesByRoot.values()).map((tree) => {
		const cleaned = bumpWhitelistedListItems([tree]);
		return cleaned[0] || tree;
	});
	return cleanedTrees;
};