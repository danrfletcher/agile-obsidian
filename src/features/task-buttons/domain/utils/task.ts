import type { TaskItem } from "@features/task-index";

/**
 * Check if task has no children.
 */
export function isLeafTask(task: TaskItem): boolean {
	return !task.children || task.children.length === 0;
}

/**
 * Get "best guess" file path for the task.
 * Uses link.path if present; falls back to _uniqueId's prefix (before ':').
 */
export function getTaskFilePath(task: TaskItem): string {
	const uid = (task as any)._uniqueId || "";
	const fromUid = uid.split(":")[0] || "";
	const linkPath = task.link?.path || "";
	return linkPath || fromUid || "";
}

/**
 * Try to guess the task's primary line index in the file.
 */
export function guessTaskLineIndex(task: TaskItem): number {
	const pos = (task as any)?.position?.start?.line;
	if (typeof pos === "number") return pos;
	if (typeof (task as any).line === "number") return (task as any).line;
	return -1;
}
