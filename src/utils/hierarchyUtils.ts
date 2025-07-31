import { TaskItem } from "../types/TaskItem";

export const deepClone = <T>(obj: T): T => {
	return JSON.parse(JSON.stringify(obj)); // structuredClone if available
};

/**
 * Climbs the task hierarchy from the given task to find the first ancestor that matches the provided predicate.
 * Uses parent IDs and the taskMap to traverse upwards. If no predicate is provided, returns the top ancestor (root).
 * Useful for identifying higher-level parents like initiatives or epics in task trees - e.g. in parentFinders for structuring views like projectView or OKR linked trees.
 * @param {TaskItem} task - The starting task to climb from.
 * @param {(t: TaskItem) => boolean} [predicate] - A function that returns true for the desired ancestor (defaults to checking for root: t.parent < 0).
 * @param {Map<string, TaskItem>} taskMap - Map of unique task IDs to TaskItems for parent lookups.
 * @returns {TaskItem | null} The matching ancestor (or the task itself if it matches), or null if none found.
 */
export const findAncestor = (
	task: TaskItem,
	predicate: (t: TaskItem) => boolean = (t) => t.parent < 0, // Default predicate here
	taskMap: Map<string, TaskItem>
): TaskItem | null => {
	// Check the starting task first (handles roots/isolated tasks)
	if (predicate(task)) {
		return task;
	}

	// Traverse upwards
	let current = task;
	while (current._parentId && taskMap.has(current._parentId ?? "")) {
		current = taskMap.get(current._parentId ?? "")!;
		if (predicate(current)) {
			return current;
		}
	}

	return null; // No match found
};

/**
 * Recursively builds a full subtree for the given task, including all nested children.
 * Clones the structure without modifying the original.
 * Useful for creating complete task hierarchies before pruning or processing - e.g. in OKR linked trees or priority/responsibility trees in projectView.
 * @param {TaskItem} task - The root task to build the subtree from.
 * @param {Map<string, TaskItem[]>} [childrenMap] - Optional map of task IDs to their children arrays (falls back to task.children if not provided).
 * @returns {TaskItem} The task with its full subtree of children.
 */
export const buildFullSubtree = (
	task: TaskItem,
	childrenMap?: Map<string, TaskItem[]>
): TaskItem => {
	const children = childrenMap
		? childrenMap.get(task._uniqueId ?? "") || []
		: task.children;
	return {
		...task,
		children: children.map((child) => buildFullSubtree(child, childrenMap)),
	};
};

/**
 * Traverses upwards from the given task to find the topmost (root) ancestor.
 * Stops at the task with no parent. Internally uses findAncestor for traversal.
 * Useful for grouping tasks by their root in hierarchies - e.g. in OKR roots, linked OKRs, or responsibility trees in projectView.
 * @param {TaskItem} task - The task to start from.
 * @param {Map<string, TaskItem>} taskMap - Map of unique task IDs to TaskItems for parent lookups.
 * @returns {TaskItem | null} The top ancestor (root) task, or null if not found.
 */
export const getTopAncestor = (
	task: TaskItem,
	taskMap: Map<string, TaskItem>
): TaskItem | null => {
	return findAncestor(task, undefined, taskMap); // Defaults to root predicate
};

/**
 * Builds an array representing the path from the given task to a specific ancestor (inclusive).
 * Traverses upwards using parent IDs and taskMap; returns an empty array if no path found. Path is ancestor-first.
 * Useful for reconstructing paths in non-structured or recurring task hierarchies - e.g. in processing non-structured tasks or responsibilities in projectView.
 * @param {TaskItem} task - The starting task.
 * @param {string} ancestorId - The unique ID of the target ancestor.
 * @param {Map<string, TaskItem>} taskMap - Map of unique task IDs to TaskItems for parent lookups.
 * @returns {TaskItem[]} The path as an array of tasks, from ancestor to starting task.
 */
export const getPathToAncestor = (
	task: TaskItem,
	ancestorId: string,
	taskMap: Map<string, TaskItem>
): TaskItem[] => {
	const path: TaskItem[] = [];
	let current = task;
	while (current && current._uniqueId !== ancestorId) {
		path.push(current);
		if (!current._parentId || !taskMap.has(current._parentId ?? "")) break;
		current = taskMap.get(current._parentId ?? "")!;
	}
	if (current && current._uniqueId === ancestorId) path.push(current); // Include ancestor if found
	return path.reverse(); // Ancestor first
};

/**
 * Constructs a hierarchical tree structure from a flat path array (e.g., ancestor to descendant).
 * Each node in the path becomes a parent-child chain.
 * Useful for building merged or pruned trees from paths - e.g. in handling non-structured tasks or responsibility subtrees in projectView.
 * @param {TaskItem[]} path - The array of tasks representing the path (ancestor first).
 * @returns {TaskItem | null} The root of the built hierarchy, or null if path is empty.
 */
export const buildHierarchyFromPath = (path: TaskItem[]): TaskItem | null => {
	if (!path.length) return null;
	const root: TaskItem = { ...path[0], children: [] }; // Added type
	let cursor: TaskItem = root; // Added type
	for (let i = 1; i < path.length; i++) {
		const child: TaskItem = { ...path[i], children: [] }; // Added type
		cursor.children = [child];
		cursor = child;
	}
	return root;
};

/**
 * Strips non-task list items from a tree of nodes, flattening by attaching their children directly to the parent.
 * Traverses depth-first and removes nodes where listItem is true (and task is false), promoting children to the grandparent level.
 * Useful for cleaning up task hierarchies by removing fake bullets/headers - e.g. in pruning trees for OKR linked items or other project views.
 * @param {TaskItem[]} nodes - The array of root nodes to process (e.g., a tree or list of trees).
 * @returns {TaskItem[]} A new array of filtered and flattened nodes.
 */
export const stripListItems = (nodes: TaskItem[]): TaskItem[] => {
	// Recursive DFS helper that returns the cleaned array for the current level
	const dfs = (currentNodes: TaskItem[], parentId: string | null | undefined, parentLine: number): TaskItem[] => {
		const cleaned: TaskItem[] = [];

		for (const node of currentNodes) {
			// If it's a non-task list item, promote its children (flatten) and recurse on them
			if (node.listItem === true && node.task !== true) {
				if (node.children && node.children.length > 0) {
					// Update children's parent info to match grandparent
					const promotedChildren = node.children.map((child) => ({
						...child,
						_parentId: parentId, // Attach to grandparent's ID
						parent: parentLine, // Attach to grandparent's line number
					}));
					// Recurse and add the cleaned promoted children directly
					cleaned.push(...dfs(promotedChildren, parentId, parentLine));
				}
				continue; // Skip adding this node
			}

			// Otherwise, create a cleaned node and recurse for its children
			const cleanedNode: TaskItem = {
				...node,
				children: [], // Will be populated below
			};
			cleaned.push(cleanedNode);

			// Recurse on its children, passing this node's ID/line as the new parent context
			if (node.children && node.children.length > 0) {
				cleanedNode.children = dfs(node.children, node._uniqueId, node.line);
			}
		}

		return cleaned;
	};

	// Start DFS from roots (no initial parent)
	return dfs(nodes, null, -1); // -1 as sentinel for root-level parent line
};

/**
 * Merges two task trees by combining children recursively based on unique IDs.
 * If nodes match by _uniqueId, their children are merged; otherwise, the source's branch is added.
 * Useful for consolidating overlapping task hierarchies - e.g. in building pruned linked trees for OKRs or merging responsibility subtrees in projectView.
 * @param {TaskItem} target - The base tree to merge into (modified in place).
 * @param {TaskItem} source - The tree to merge from.
 * @returns {void} Modifies the target tree in place.
 */
export const mergeTaskTrees = (target: TaskItem, source: TaskItem): void => {
	if (target._uniqueId !== source._uniqueId) return; // Safety: only merge matching nodes

	// Merge children: add unique by _uniqueId, recurse on matches
	source.children?.forEach((srcChild) => {
		const match = target.children?.find(
			(tgtChild) => tgtChild._uniqueId === srcChild._uniqueId
		);
		if (match) {
			mergeTaskTrees(match, srcChild); // Recurse to merge subtrees
		} else {
			target.children?.push(deepClone(srcChild)); // Clone and add new branch
		}
	});
};

/**
 * Builds pruned and merged task trees from a list of linked tasks.
 * For each linked task: finds the top ancestor (or matching via optional predicate), builds the path, creates a pruned hierarchy, and merges overlaps by root.
 * Useful for creating consolidated, path-pruned hierarchies from flat linked tasks - e.g. in OKR linked trees or priority/responsibility grouping in projectView.
 * @param {TaskItem[]} tasks - The array of tasks to build pruned trees from.
 * @param {Map<string, TaskItem>} taskMap - Map of unique task IDs to TaskItems for parent lookups.
 * @param {(t: TaskItem) => boolean} [ancestorPredicate] - Optional predicate for findAncestor (defaults to root: t.parent < 0).
 * @returns {TaskItem[]} The array of merged, pruned trees (one per unique root).
 */
export const buildPrunedMergedTrees = (
	tasks: TaskItem[],
	taskMap: Map<string, TaskItem>,
	ancestorPredicate?: (t: TaskItem) => boolean
): TaskItem[] => {
	const treesByRoot = new Map<string, TaskItem>();

	tasks.forEach((linkedTask) => {
		// Find root (using optional predicate)
		const root = findAncestor(linkedTask, ancestorPredicate, taskMap);
		if (!root || !root._uniqueId) {
			console.warn(`No root for linkedTask: ${linkedTask._uniqueId}`);
			return;
		}

		// Get path and build pruned tree
		const path = getPathToAncestor(linkedTask, root._uniqueId, taskMap);
		if (path.length === 0) {
			console.warn(`Empty path for linkedTask: ${linkedTask._uniqueId}`);
			return;
		}
		const prunedTree = buildHierarchyFromPath(path);
		if (!prunedTree) return;

		// Group and merge
		const rootId = root._uniqueId;
		if (!treesByRoot.has(rootId)) {
			treesByRoot.set(rootId, { ...root, children: [] }); // Init with pruned root (empty children)
		}
		const existingTree = treesByRoot.get(rootId)!;
		mergeTaskTrees(existingTree, prunedTree);
	});

	// After merging all trees, strip list items from each root tree
	let cleanedTrees = Array.from(treesByRoot.values());
	cleanedTrees = cleanedTrees.map((tree) => {
		// Wrap in array for stripping (since stripListItems takes an array of roots)
		const cleaned = stripListItems([tree]);
		return cleaned[0] || tree; // Return the first (and only) cleaned root, or original if empty
	});

	return cleanedTrees;
};
