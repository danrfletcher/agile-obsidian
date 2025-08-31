import { TaskItem } from "src/features/tasks/task-item";
import { hasTargetDate } from "./task-filters";

/**
 * Calculates the earliest relevant date for a task based on its due, scheduled, target (🎯), or start dates.
 * Prioritizes non-start dates if available; falls back to start. Returns a far-future date if no valid dates are found.
 * Useful for sorting tasks by urgency or deadlines - e.g. in deadlineView for ordering tasks or in isRelevantToday checks.
 * @param {TaskItem} task - The task object to extract dates from.
 * @returns {Date} The earliest date, or a far-future date if none are available.
 */
export const getEarliestDate = (task: TaskItem): Date => {
	const candidates: string[] = [];
	const nonStart: string[] = [];
	if (task.due) nonStart.push(task.due);
	if (task.scheduled) nonStart.push(task.scheduled);
	const m = hasTargetDate(task);
	if (m) nonStart.push(m);
	if (nonStart.length) candidates.push(...nonStart);
	else if (task.start) candidates.push(task.start);
	const dates = candidates
		.map((d) => new Date(d))
		.filter((d) => !isNaN(d.getTime()));
	if (!dates.length) return new Date(8640000000000000);
	return dates.reduce((a: Date, b: Date) => (a < b ? a : b), dates[0]);
};

/**
 * Checks if a task's date pattern (🗓️) matches the current day (e.g., day of week like "sunday" or day of month like "20").
 * Supports patterns like "sundays", "everyday", or "daily". Ignores time portions.
 * Useful for regular responsibilities or tasks that recur on specific days - e.g. in "Responsibilities" section.
 * @param {TaskItem} task - The task object containing the text to check for patterns.
 * @returns {boolean} True if the pattern matches today, false otherwise.
 */
export const matchesDatePattern = (task: TaskItem): boolean => {
	const today = new Date();
	const dayOfWeek = today
		.toLocaleString("en-us", { weekday: "long" })
		.toLowerCase();
	const dayOfMonth = today.getDate();

	const patterns = (
		task.text.match(/🗓️\s*([^<]+?)(?=\s*<mark|$)/g) || []
	).map((p) => p.replace("🗓️", "").trim().toLowerCase());

	for (const pattern of patterns) {
		const validDays = [
			"monday",
			"tuesday",
			"wednesday",
			"thursday",
			"friday",
			"saturday",
			"sunday",
		];
		let basePattern = pattern.split(" ")[0];
		if (basePattern.endsWith("s")) basePattern = basePattern.slice(0, -1);
		if (validDays.includes(basePattern) && basePattern === dayOfWeek)
			return true;

		const dayMatch = pattern.match(/^\d{2}$/);
		if (dayMatch && parseInt(dayMatch[0]) === dayOfMonth) return true;

		if (pattern.includes("everyday") || pattern.includes("daily"))
			return true;
	}
	return false;
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
