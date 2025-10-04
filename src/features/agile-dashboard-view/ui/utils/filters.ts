/**
 * Shared filtering utilities for Agile Dashboard sections.
 */

import type { TaskItem, TaskParams } from "@features/task-index";
import {
	isCancelled,
	isCompleted,
	isInProgress,
	isSnoozed,
} from "@features/task-filter";

/**
 * Return true when a task should be visible based on current status toggles and snooze.
 *
 * - inProgress => include active/in-progress tasks (but not snoozed)
 * - completed  => include completed items
 * - sleeping   => include snoozed items (for the selected alias context)
 * - cancelled  => include cancelled items
 */
export function isShownByParams(
	task: TaskItem,
	taskMap: Map<string, TaskItem>,
	selectedAlias: string | null,
	params: TaskParams
): boolean {
	const { inProgress, completed, sleeping, cancelled } = params;
	const snoozedForAlias = isSnoozed(task, taskMap, selectedAlias);

	const includeInProgress =
		inProgress &&
		isInProgress(task, taskMap, selectedAlias) &&
		!snoozedForAlias;
	const includeCompleted = completed && isCompleted(task);
	const includeSleeping = sleeping && snoozedForAlias;
	const includeCancelled = cancelled && isCancelled(task);

	return (
		includeInProgress ||
		includeCompleted ||
		includeSleeping ||
		includeCancelled
	);
}
