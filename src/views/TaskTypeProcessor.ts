import { buildFullSubtree } from "src/utils/hierarchyUtils";
import { TaskItem } from "../types/TaskItem";

export function processTaskType(
	currentTasks: TaskItem[],
	filter: (task: TaskItem) => boolean,
	parentFinders: {
		finder: (t: TaskItem) => TaskItem | null;
		label: string;
		typeCheck: (t: TaskItem) => boolean;
	}[]
): TaskItem[] {
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
		.map(buildFullSubtree); // Assumes buildFullSubtree imported or available

	// Prune subtrees to only include relevant paths
	const pruneSubtree = (node: TaskItem, level: number): TaskItem | null => {
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
