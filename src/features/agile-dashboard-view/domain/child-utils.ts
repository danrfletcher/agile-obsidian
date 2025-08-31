import { TaskItem } from "src/features/tasks/task-item";

/**
 * Recursively attaches filtered children to a task up to a specified depth.
 * Modifies the task's children array in place. Useful for selectively expanding subtrees in hierarchies.
 * @param {TaskItem} task - The task to attach children to.
 * @param {number} depth - Max recursion depth (0 = no children, 1 = one level, -1 = unlimited).
 * @param {(t: TaskItem) => boolean} [filterCallback] - Function to filter which children to include (defaults to keeping all: () => true).
 * @param {Map<string, TaskItem[]>} childrenMap - Map of task IDs to their direct children.
 */
export const attachFilteredChildren = (
	task: TaskItem,
	depth: number,
	filterCallback: (t: TaskItem) => boolean = (t) => true, // Default to keep all
	childrenMap: Map<string, TaskItem[]>
): void => {
	if (depth === 0) return; // Stop at depth 0 (no children)

	// Get direct children and filter them (using default if not provided)
	const directChildren = (childrenMap.get(task._uniqueId ?? "") || []).filter(
		filterCallback
	);

	// Attach filtered children (initialize with empty children array)
	task.children = directChildren.map((child) => ({ ...child, children: [] }));

	// Recurse for each attached child
	const nextDepth = depth === -1 ? -1 : depth - 1; // Unlimited if -1, else decrement
	task.children.forEach((child) => {
		attachFilteredChildren(child, nextDepth, filterCallback, childrenMap);
	});
};
