import type { TaskItem } from "@features/task-index";
import type { TaskWithMetadata } from "../types";

/**
 * Internal helper to access runtime-only metadata on TaskItem.
 */
function asTaskWithMetadata(task: TaskItem): TaskWithMetadata {
	return task as TaskWithMetadata;
}

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
	const taskWithMeta = asTaskWithMetadata(task);
	const uid = taskWithMeta._uniqueId ?? "";
	const fromUid = uid.split(":")[0] ?? "";
	const linkPath = task.link?.path ?? "";
	return linkPath || fromUid || "";
}

/**
 * Try to guess the task's primary line index in the file.
 */
export function guessTaskLineIndex(task: TaskItem): number {
	const taskWithMeta = asTaskWithMetadata(task);
	const pos = taskWithMeta.position?.start?.line;
	if (typeof pos === "number") return pos;
	if (typeof taskWithMeta.line === "number") return taskWithMeta.line;
	return -1;
}