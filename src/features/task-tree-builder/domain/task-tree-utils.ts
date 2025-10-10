import { TaskItem } from "@features/task-index";

/**
 * Strips non-task list items from a tree of nodes, flattening by attaching their children directly to the parent.
 * Traverses depth-first and removes nodes where listItem is true (and task is false), promoting children to the grandparent level.
 * Useful for cleaning up task hierarchies by removing fake bullets/headers - e.g. in pruning trees for OKR linked items or other project views.
 * Mutation: none (pure). Returns new nodes/arrays.
 * @param {TaskItem[]} nodes - The array of root nodes to process (e.g., a tree or list of trees).
 * @returns {TaskItem[]} A new array of filtered and flattened nodes.
 */
export const stripListItems = (nodes: TaskItem[]): TaskItem[] => {
	const dfs = (
		currentNodes: TaskItem[],
		parentId: string | null | undefined,
		parentLine: number
	): TaskItem[] => {
		const cleaned: TaskItem[] = [];
		for (const node of currentNodes) {
			const kids = Array.isArray(node.children) ? node.children : [];
			if (node.listItem === true && node.task !== true) {
				if (kids.length > 0) {
					const promotedChildren = kids.map((child) => ({
						...child,
						_parentId: parentId,
						parent: parentLine,
					}));
					cleaned.push(
						...dfs(promotedChildren, parentId, parentLine)
					);
				}
				continue;
			}
			const cleanedNode: TaskItem = { ...node, children: [] };
			cleaned.push(cleanedNode);
			if (kids.length > 0) {
				cleanedNode.children = dfs(kids, node._uniqueId, node.line);
			}
		}
		return cleaned;
	};
	return dfs(nodes || [], null, -1);
};
