import { TaskItem } from "../types/TaskItem";

export const deepClone = <T>(obj: T): T => {
	return JSON.parse(JSON.stringify(obj)); // Simple clone; use structuredClone if available
};

/**
 * Climbs the task hierarchy from the given task to find the first ancestor that matches the provided predicate.
 * Uses parent IDs to traverse upwards.
 * Useful for identifying higher-level parents like initiatives or epics in task trees - e.g. in parentFinders for structuring views like projectView.
 * @param {TaskItem} task - The starting task to climb from.
 * @param {(t: TaskItem) => boolean} predicate - A function that returns true for the desired ancestor.
 * @returns {TaskItem | null} The matching ancestor, or null if none found.
 */
export const findAncestor = (
	task: TaskItem,
	predicate: (t: TaskItem) => boolean
): TaskItem | null => {
	// eslint-disable-next-line
	let current = task;
	while (current.parent >= 0) {
		// TODO: Fetch parent from index (placeholder - assume flat list or add lookup)
		// For now, placeholder - implement full climb using TaskIndex
		// if (predicate(current)) return current;
		// current = ... (fetch parent)
		break; // Placeholder
	}
	return null;
};

/**
 * Recursively builds a full subtree for the given task, including all nested children.
 * Clones the structure without modifying the original.
 * Useful for creating complete task hierarchies before pruning or processing - e.g. in OKR linked trees or priority/responsibility trees in projectView.
 * @param {TaskItem} task - The root task to build the subtree from.
 * @returns {TaskItem} The task with its full subtree of children.
 */
export const buildFullSubtree = (task: TaskItem): TaskItem => {
	return {
		...task,
		children: task.children.map(buildFullSubtree),
	};
};

/**
 * Traverses upwards from the given task to find the topmost (root) ancestor.
 * Stops at the task with no parent.
 * Useful for grouping tasks by their root in hierarchies - e.g. in OKR roots, linked OKRs, or responsibility trees in projectView.
 * @param {TaskItem} task - The task to start from.
 * @returns {TaskItem} The top ancestor (root) task.
 */
export const getTopAncestor = (task: TaskItem): TaskItem => {
	// eslint-disable-next-line
	let current = task;
	while (current.parent >= 0) {
		// TODO: Fetch parent
		break;
	}
	return current;
};

/**
 * Builds an array representing the path from the given task to a specific ancestor (inclusive).
 * Traverses upwards using parent IDs; returns an empty array if no path found.
 * Useful for reconstructing paths in non-structured or recurring task hierarchies - e.g. in processing non-structured tasks or responsibilities in projectView.
 * @param {TaskItem} task - The starting task.
 * @param {string} ancestorId - The unique ID of the target ancestor.
 * @returns {TaskItem[]} The path as an array of tasks, from ancestor to starting task.
 */
export const getPathToAncestor = (
	task: TaskItem,
	ancestorId: string
): TaskItem[] => {
	const path = [];
	// eslint-disable-next-line
	let current = task;
	while (current && current._uniqueId !== ancestorId) {
		// Fixed: no space
		path.push(current);
		// TODO: Fetch parent by ID
		break;
	}
	return path.reverse();
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
 * Prunes a task tree to include only paths leading to tasks in the assigned set.
 * Recursively processes children and retains nodes with relevant descendants.
 * Useful for filtering and structuring task trees by type - e.g. in processTaskType for pruning tasks, stories, or epics in projectView.
 * @param {TaskItem} task - The root task to process.
 * @param {Set<string>} assignedSet - Set of unique task IDs considered "assigned".
 * @returns {TaskItem | null} The pruned task subtree, or null if no relevant paths.
 */
export const processTaskHierarchy = (
	task: TaskItem,
	assignedSet: Set<string>
): TaskItem | null => {
	if (!task) return null;
	if (assignedSet.has(task._uniqueId ?? "")) return { ...task, children: [] }; // Fixed: no space, nullish coalescing
	const kids = task.children
		.map((t) => processTaskHierarchy(t, assignedSet))
		.filter((t): t is TaskItem => t !== null); // Type guard to exclude null
	return kids.length ? { ...task, children: kids } : null;
};

/**
 * Strips fake headers from a list of nodes, preserving only "Now" headers and flattening others.
 * Useful for cleaning up task lists before processing - e.g. in initial task collection in projectView.
 * @param {TaskItem[]} nodes - The nodes to process.
 * @returns {TaskItem[]} The filtered and flattened nodes.
 */
export const stripFakeHeaders = (nodes: TaskItem[]): TaskItem[] => {
    const out: TaskItem[] = [];
    for (const node of nodes) {
        const isNowHeader = node.task === false && /🚀\s*\*\*Now\*\*/.test(node.text);
        if (isNowHeader) {
            node.children.forEach((child) => {
                if (node._parentId !== undefined) {
                    child._parentId = node._parentId; // Safe access with check
                }
                child.parent = node.parent;
            });
            out.push(...stripFakeHeaders(node.children));
        } else {
            out.push({
                ...node,
                children: stripFakeHeaders(node.children),
            });
        }
    }
    return out;
};
