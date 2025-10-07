import type { TaskItem } from "@features/task-index";
import {
	isCancelled,
	isCompleted,
	getAgileArtifactType,
} from "@features/task-filter";

/**
 * Map Obsidian task status to grouping buckets:
 * 0 = unchecked " ", 1 = partial "/", 2 = all others.
 */
/**
 * Map Obsidian task status to grouping buckets for sorting:
 * 0 = all others, 1 = in progress "/", 2 = unstarted " ".
 */
export function groupByStatus(task: TaskItem): number {
	const s = task.status ?? "";
	if (s === "/") return 1;
	if (s === " ") return 2;
	return 0;
}

/**
 * Safe line number extraction for stable ordering.
 */
export function startLineOf(task: TaskItem): number {
	return task?.position?.start?.line ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Default comparator for tasks.
 * Group first, then by start line.
 */
export function defaultTaskComparator(a: TaskItem, b: TaskItem): number {
	const ga = groupByStatus(a);
	const gb = groupByStatus(b);
	if (ga !== gb) return ga - gb;
	return startLineOf(a) - startLineOf(b);
}

/**
 * Return filtered, optionally typed, and sorted direct children.
 */
export function getFilteredSortedDirectChildren(
	uid: string,
	childrenMap: Map<string, TaskItem[]>,
	childType?: string
): TaskItem[] {
	let arr = childrenMap.get(uid) || [];
	if (childType) {
		arr = arr.filter((c) => (getAgileArtifactType(c) ?? "") === childType);
	}
	arr = arr.filter((c) => !isCompleted(c) && !isCancelled(c));
	return arr.slice().sort(defaultTaskComparator);
}
