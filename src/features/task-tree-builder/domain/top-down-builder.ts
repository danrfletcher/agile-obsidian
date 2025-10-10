import { TaskItem } from "@features/task-index";

/**
 * Recursively attaches filtered children to a task up to a specified depth.
 * Modifies the task's children array in place. Useful for selectively expanding subtrees in hierarchies.
 * Mutation: in-place on 'task'.
 * @param {TaskItem} task - The task to attach children to.
 * @param {number} depth - Max recursion depth (0 = no children, 1 = one level, -1 = unlimited).
 * @param {(t: TaskItem) => boolean} [filterCallback] - Function to filter which children to include (defaults to keeping all: () => true).
 * @param {Map<string, TaskItem[]>} childrenMap - Map of task IDs to their direct children.
 */
export const attachFilteredChildren = (
	task: TaskItem,
	depth: number,
	filterCallback: (t: TaskItem) => boolean = () => true,
	childrenMap: Map<string, TaskItem[]>
): void => {
	if (!task) return;
	if (depth === 0) return;

	const directChildren = (childrenMap.get(task._uniqueId ?? "") || []).filter(
		filterCallback
	);

	// In-place assign children
	task.children = directChildren.map((child) => ({ ...child, children: [] }));

	const nextDepth = depth === -1 ? -1 : depth - 1;
	for (const child of task.children) {
		attachFilteredChildren(child, nextDepth, filterCallback, childrenMap);
	}
};

/**
 * Pure variant: returns a new task with attached children; does not mutate inputs.
 * Mutation: none (pure).
 */
export const attachFilteredChildrenPure = (
	task: TaskItem,
	depth: number,
	filterCallback: (t: TaskItem) => boolean = () => true,
	childrenMap: Map<string, TaskItem[]>
): TaskItem => {
	if (!task) return task;
	if (depth === 0) return { ...task, children: [] };

	const directChildren = (childrenMap.get(task._uniqueId ?? "") || []).filter(
		filterCallback
	);

	const nextDepth = depth === -1 ? -1 : depth - 1;
	return {
		...task,
		children: directChildren.map((child) =>
			attachFilteredChildrenPure(
				child,
				nextDepth,
				filterCallback,
				childrenMap
			)
		),
	};
};

/**
 * Recursively builds a full subtree for the given task, including all nested children.
 * Clones the structure without modifying the original.
 * Useful for creating complete task hierarchies before pruning or processing - e.g. in OKR linked trees or priority/responsibility trees in projectView.
 * Mutation: none (pure).
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
		: Array.isArray(task.children)
		? task.children
		: [];
	return {
		...task,
		children: children.map((child) => buildFullSubtree(child, childrenMap)),
	};
};
