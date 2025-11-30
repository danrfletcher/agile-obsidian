import { TaskItem } from "@features/task-index";
import { isWhitelistedListHeader } from "@features/task-filter";

/**
 * Bumps children of whitelisted non-task list header items up one level in the tree.
 *
 * A "whitelisted list header" is a node where:
 *   - listItem === true
 *   - task !== true
 *   - and the rendered line contains one of the known template keys
 *     (see isWhitelistedListHeader / WhitelistedListHeaderTemplateKeys),
 *     currently the NALAp priority headers.
 *
 * For those nodes, their children are promoted to the parent level and inherit
 * the parent's id/line; the header node itself is removed from the tree.
 *
 * All other list items and tasks are preserved so they can appear in trees and
 * receive chevrons normally.
 *
 * Mutation: none (pure). Returns new nodes/arrays.
 * @param {TaskItem[]} nodes - The array of root nodes to process (e.g., a tree or list of trees).
 * @returns {TaskItem[]} A new array of filtered and flattened nodes.
 */
export const bumpWhitelistedListItems = (nodes: TaskItem[]): TaskItem[] => {
	const dfs = (
		currentNodes: TaskItem[],
		parentId: string | null | undefined,
		parentLine: number
	): TaskItem[] => {
		const cleaned: TaskItem[] = [];

		for (const node of currentNodes) {
			const kids = Array.isArray(node.children) ? node.children : [];

			const isWhitelistedHeader =
				node.listItem === true &&
				node.task !== true &&
				isWhitelistedListHeader(node);

			// For whitelisted list headers: drop the header itself and
			// promote its children to the parent level.
			if (isWhitelistedHeader) {
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

			// Keep all other nodes (including ordinary list items) intact.
			const cleanedNode: TaskItem = { ...node, children: [] };
			cleaned.push(cleanedNode);

			if (kids.length > 0) {
				cleanedNode.children = dfs(
					kids,
					node._uniqueId,
					node.line
				);
			}
		}

		return cleaned;
	};

	return dfs(nodes || [], null, -1);
};