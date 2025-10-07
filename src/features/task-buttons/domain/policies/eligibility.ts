import type { TaskItem } from "@features/task-index";
import { isLeafTask } from "../utils/task";

/**
 * Decide if a snooze button should be shown for a task in a given normalized section.
 */
export function shouldShowSnoozeButton(
	task: TaskItem,
	normalizedSection: string,
	artifactType: string
): boolean {
	const section = (normalizedSection || "").toLowerCase();

	// Objectives – Linked Items: snooze on leaves only
	if (
		section === "objectives-linked" ||
		section.includes("objectives-linked")
	) {
		return isLeafTask(task);
	}

	// Objectives: snooze on the Objectives themselves (OKR lines)
	if (section === "objectives") {
		return artifactType === "okr";
	}

	// Responsibilities: snooze on the recurring responsibilities themselves
	if (section === "responsibilities") {
		return artifactType === "recurring-responsibility";
	}

	// Tasks/Stories/Epics: snooze on bottom-level items (leaves) in their trees
	if (section === "tasks" || section === "stories" || section === "epics") {
		return isLeafTask(task);
	}

	// Initiatives: snooze on everything at every level
	if (section === "initiatives") {
		return true;
	}

	// Priorities: conservative default – leaves only
	if (section === "priorities") {
		return isLeafTask(task);
	}

	return false;
}

/**
 * Decide if a "Snooze All Subtasks" button should be shown.
 * Requires at least 2 eligible children to avoid noise.
 */
export function shouldShowSnoozeAll(
	task: TaskItem,
	normalizedSection: string,
	getArtifactType: (t: TaskItem) => string
): boolean {
	if ((normalizedSection || "").toLowerCase() === "objectives") return false;

	const children = task.children || [];
	if (children.length < 2) return false;

	const eligibleChildren = children.filter((child) =>
		shouldShowSnoozeButton(child, normalizedSection, getArtifactType(child))
	);

	return eligibleChildren.length >= 2;
}
