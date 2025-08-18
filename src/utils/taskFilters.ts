import { TaskItem } from "../types/TaskItem";
import { name } from "./config";

export const fullName = name || "Default Name"; // Replace with dynamic if needed (e.g., from settings)
export const teamMemberName = fullName.toLowerCase().split(" ").join("-");

/**
 * Checks if a task is marked as completed with a ✅ emoji followed by a YYYY-MM-DD date.
 * Useful for excluding or sorting completed tasks - e.g. in isRelevantToday or deadlineView filtering.
 * @param {TaskItem} task - The task to check.
 * @returns {boolean} True if the completion marker is present, false otherwise.
 */
export const isMarkedCompleted = (task: TaskItem): boolean => {
	return /✅\s\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])/.test(
		task.text
	);
};

/**
 * Checks if a task is marked as cancelled with a ❌ emoji.
 * Useful for excluding cancelled tasks from active views - e.g. in projectView filters or activeForMember checks.
 * @param {TaskItem} task - The task to check.
 * @returns {boolean} True if the cancel marker is present, false otherwise.
 */
export const isCancelled = (task: TaskItem): boolean => {
	return /❌/.test(task.text);
};

/**
 * Checks if a task is considered "in progress", meaning it is not completed, not cancelled, and not sleeping.
 * Useful for filtering active, ongoing tasks in views - e.g. in projectView sections or deadline filtering.
 * @param {TaskItem} task - The task to check.
 * @returns {boolean} True if the task is in progress, false otherwise.
 */
export const isInProgress = (
	task: TaskItem,
	taskMap: Map<string, TaskItem>
): boolean => {
	return (
		!isMarkedCompleted(task) &&
		!isCancelled(task) &&
		!isSleeping(task, taskMap)
	);
};

/**
 * Checks if a task is snoozed (💤), either directly or inherited from ancestors (💤⬇️).
 * Supports global and member-specific snoozes with optional dates.
 * Useful for excluding temporarily hidden tasks - e.g. in projectView filters across sections like tasks, epics, or initiatives.
 * @param {TaskItem} task - The task to check.
 * @param {Map<string, TaskItem>} taskMap - Map of unique task IDs to TaskItems for parent lookups.
 * @returns {boolean} True if snoozed (date in future or indefinite), false otherwise.
 */
export const isSleeping = (task: TaskItem, taskMap: Map<string, TaskItem>): boolean => {
	if (!task || typeof task.text !== "string") {
		return false;
	}

	const today = new Date();
	today.setHours(0, 0, 0, 0);

	const checkSnooze = (
		matches: RegExpMatchArray[],
		isGlobalCheck = true
	): boolean => {
		const globalSnooze = matches.find((match) => !match[1]);
		if (globalSnooze && isGlobalCheck) {
			if (!globalSnooze[2]) {
				return true; // Indefinite global snooze
			}
			const [year, month, day] = globalSnooze[2].split("-").map(Number);
			const target = new Date(year, month - 1, day);
			if (isNaN(target.getTime())) {
				return false;
			}
			target.setHours(0, 0, 0, 0);
			if (target > today) {
				return true;
			}
			return false;
		}

		const memberSnooze = matches.find(
			(match) => match[1] === teamMemberName
		);
		if (memberSnooze) {
			if (!memberSnooze[2]) {
				return true; // Indefinite member snooze
			}
			const [year, month, day] = memberSnooze[2].split("-").map(Number);
			const target = new Date(year, month - 1, day);
			if (isNaN(target.getTime())) {
				return false;
			}
			target.setHours(0, 0, 0, 0);
			if (target > today) {
				return true;
			}
			return false;
		}
		return false;
	};

	// Check direct snooze on the task itself ('💤' but not if followed by '⬇️')
	const directMatches = [
		...task.text.matchAll(
			/💤(?!⬇️)\s*(?:<span[^>]*style="display:\s*none"[^>]*>([^<]*)<\/span>)?\s*(\d{4}-\d{2}-\d{2})?/g
		),
	];

	if (directMatches.length && checkSnooze(directMatches)) {
		return true;
	}

	// Check inherited subtask snoozes from ancestors ('💤⬇️')
	let currentParentId = task._parentId;
	const seen = new Set<string>();

	while (currentParentId && !seen.has(currentParentId)) {
		seen.add(currentParentId);

		const parentTask = taskMap.get(currentParentId);
		if (!parentTask) {
			break; // No parent found, stop traversal
		}

		// Check for inherited snooze on this parent ('💤⬇️')
		const inheritedMatches = [
			...parentTask.text.matchAll(
				/💤⬇️\s*(?:<span[^>]*style="display:\s*none"[^>]*>([^<]*)<\/span>)?\s*(\d{4}-\d{2}-\d{2})?/g
			),
		];

		if (inheritedMatches.length && checkSnooze(inheritedMatches)) {
			return true;
		}

		// Move up to the next parent
		currentParentId = parentTask._parentId;
	}

	return false;
};

/**
 * Checks if a task is active for the member, ensuring it contains the active tag and not the inactive one.
 * Useful for filtering tasks in active/inactive views - e.g. in projectView sections.
 * @param {TaskItem} task - The task to check.
 * @param {boolean} active - Whether to check for active (true) or inactive (false) status.
 * @returns {boolean} True if it matches the criteria, false otherwise.
 */
export const activeForMember = (task: TaskItem, active = true): boolean => {
    const activePattern = new RegExp(`active-${teamMemberName}(?![\\w-])`, "i");
    const inactivePattern = new RegExp(`inactive-${teamMemberName}(?![\\w-])`, "i");

    const hasActive = activePattern.test(task.text);
    const hasInactive = inactivePattern.test(task.text);

    if (active) {
        return hasActive && !hasInactive
    } else {
        return hasInactive
    }
};

/**
 * Checks if a task is assigned to any user via an "active-" tag.
 * Useful for detecting general assignments or inferred assignments - e.g. in non-structured task processing or responsibilities in projectView.
 * @param {TaskItem} task - The task to check.
 * @returns {boolean} True if assigned to any user, false otherwise.
 */
export const isAssignedToAnyUser = (task: TaskItem): boolean => {
	return /active-[\w-]+/.test(task.text);
};

/**
 * Checks if a task is assigned to the current member or the team via active tags.
 * Useful for inclusive assignment checks in recurring or team contexts - e.g. in collecting responsibilities or inferred assignments in projectView's "Responsibilities" section.
 * @param {TaskItem} task - The task to check.
 * @returns {boolean} True if assigned to member or team, false otherwise.
 */
export const isAssignedToMemberOrTeam = (task: TaskItem): boolean => {
	return (
		activeForMember(task) ||
		/class\s*=\s*"[^"]*\bactive-team\b[^"]*"/i.test(task.text)
	);
};

/**
 * Extracts a target date (🎯 YYYY-MM-DD) from the task text if present.
 * Useful for identifying tasks with custom targets in date calculations - e.g. in getEarliestDate or deadlineView filtering.
 * @param {TaskItem} task - The task to check.
 * @returns {string | false} The extracted date string, or false if none found.
 */
export const hasTargetDate = (task: TaskItem): string | false => {
	if (!task || typeof task.text !== "string") return false;
	const match = task.text.match(/🎯\s*(\d{4}-\d{2}-\d{2})/);
	return match ? match[1] : false;
};