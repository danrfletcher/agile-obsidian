import { TaskItem } from "../types/TaskItem";
import { overrideTeamMemberName } from "./config";

export const fullName = overrideTeamMemberName || "Default Name"; // Replace with dynamic if needed (e.g., from settings)
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
 * Checks if a task is active (or inactive) for a specific team member based on tags like "active-membername".
 * Excludes cancelled tasks.
 * Useful for member-specific filtering of assigned tasks - e.g. in projectView, deadlineView, or OKR assignments.
 * @param {TaskItem} task - The task to check.
 * @param {boolean} [status=true] - True to check for active, false for inactive.
 * @returns {boolean} True if the task matches the status for the member, false otherwise.
 */
export const activeForMember = (task: TaskItem, status = true): boolean => {
	// Fixed: Removed explicit : boolean type
	const pattern = status
		? `^(?!.*inactive-${teamMemberName}(?![\\w-])).*active-${teamMemberName}(?![\\w-])`
		: `inactive-${teamMemberName}(?![\\w-])`;
	const re = new RegExp(pattern, "i");
	return re.test(task.text) && !isCancelled(task);
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
 * Determines if a task is relevant for today based on its start and scheduled dates.
 * Excludes completed or cancelled tasks.
 * Useful for filtering tasks that should appear in daily views - e.g. in projectView for objectives, tasks, or priorities.
 * @param {TaskItem} task - The task to evaluate.
 * @returns {boolean} True if relevant today, false otherwise.
 */
export const isRelevantToday = (task: TaskItem): boolean => {
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	// Assume task has optional due/scheduled/start properties (add to TaskItem if needed)
	const start = task.start ? new Date(task.start) : null;
	// Removed unused 'due' assignment; re-add if needed for logic
	const scheduled = task.scheduled ? new Date(task.scheduled) : null;
	if (task.completed || task.status === "-") return false;
	return (
		(!start && !scheduled) ||
		((!start || start <= today) && (!scheduled || scheduled <= today))
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

/**
 * Checks if a task is snoozed (💤), either directly or inherited from ancestors (💤⬇️).
 * Supports global and member-specific snoozes with optional dates.
 * Useful for excluding temporarily hidden tasks - e.g. in projectView filters across sections like tasks, epics, or initiatives.
 * @param {TaskItem} task - The task to check.
 * @returns {boolean} True if snoozed (date in future or indefinite), false otherwise.
 */
export const isSleeping = (task: TaskItem): boolean => {
	if (!task || typeof task.text !== "string") return false;

	const today = new Date();
	today.setHours(0, 0, 0, 0);

	const checkSnooze = (
		matches: RegExpMatchArray[],
		isGlobalCheck = true
	): boolean => {
		const globalSnooze = matches.find((match) => !match[1]);
		if (globalSnooze && isGlobalCheck) {
			if (!globalSnooze[2]) return true; // Indefinite global snooze
			const [year, month, day] = globalSnooze[2].split("-").map(Number);
			const target = new Date(year, month - 1, day);
			if (isNaN(target.getTime())) return false;
			target.setHours(0, 0, 0, 0);
			if (target > today) return true;
			return false;
		}

		const memberSnooze = matches.find(
			(match) => match[1] === teamMemberName
		);
		if (memberSnooze) {
			if (!memberSnooze[2]) return true; // Indefinite member snooze
			const [year, month, day] = memberSnooze[2].split("-").map(Number);
			const target = new Date(year, month - 1, day);
			if (isNaN(target.getTime())) return false;
			target.setHours(0, 0, 0, 0);
			return target > today;
		}
		return false;
	};

	// Check direct snooze on the task itself ('💤')
	const directMatches = [
		...task.text.matchAll(
			/💤\s*(?:<span[^>]*style="display:\s*none"[^>]*>([^<]*)<\/span>)?\s*(\d{4}-\d{2}-\d{2})?/g
		),
	];
	if (directMatches.length && checkSnooze(directMatches)) return true;

	// Check inherited subtask snoozes from ancestors ('💤⬇️') - Assumes task has _parentId or similar (adapt from index)
	const parent = task.parent; // Changed to const
	const seen = new Set();
	while (parent >= 0 && !seen.has(parent)) {
		seen.add(parent);
		// TODO: Fetch parent task from index (e.g., find by line in file)
		// For now, placeholder - implement full climb using TaskIndex
		// const parentTask = ... (fetch from index)
		// if (parentTask) { check inherited }
		break; // Placeholder
	}

	return false;
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
 * Checks if a task is directly assigned to the current member, active, not completed, relevant today, and not cancelled.
 * Useful for identifying actionable tasks in user-specific views - e.g. in projectView for prunedTasks or in TaskRenderer for snooze buttons.
 * @param {TaskItem} task - The task to check.
 * @param {boolean} [status=true] - True to check for active status, false for inactive.
 * @returns {boolean} True if directly assigned, false otherwise.
 */
export const isDirectlyAssigned = (task: TaskItem, status = true): boolean => {
    return (
        activeForMember(task, status) &&
        !task.completed &&
        isRelevantToday(task) &&
        !isCancelled(task)
    );
};
