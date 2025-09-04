import { TaskItem } from "@features/task-index"
import { escapeRegExp } from "@utils";
import { DateRe } from "./types";

/**
 * Calculates the earliest relevant date for a task based on due, scheduled, target (🎯), or start.
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
	return dates.reduce((a, b) => (a < b ? a : b), dates[0]);
};

/**
 * Extract recurrence patterns from 🗓️ markers more robustly.
 */
function extractDatePatterns(text: string): string[] {
	const raw = text || "";
	const chunks = [...raw.matchAll(/🗓️\s*([^\n<]+)/g)].map((m) => m[1]);
	return chunks
		.flatMap((c) => c.split(/[;,]/))
		.map((p) => p.trim().toLowerCase())
		.filter(Boolean);
}

/**
 * Supports day of week (monday..sunday), day of month ("01".."31"), and "everyday"/"daily".
 */
export const matchesDatePattern = (task: TaskItem): boolean => {
	const today = new Date();
	const dayOfWeek = today
		.toLocaleString("en-us", { weekday: "long" })
		.toLowerCase();
	const dayOfMonth = today.getDate();

	const patterns = extractDatePatterns(task.text);

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
		let basePattern = pattern.split(/\s+/)[0];
		if (basePattern.endsWith("s")) basePattern = basePattern.slice(0, -1);

		if (validDays.includes(basePattern) && basePattern === dayOfWeek)
			return true;

		const dayMatch = pattern.match(/^\d{1,2}$/);
		if (dayMatch) {
			const n = parseInt(dayMatch[0], 10);
			if (n === dayOfMonth) return true;
		}

		if (pattern.includes("everyday") || pattern.includes("daily"))
			return true;
	}
	return false;
};

/**
 * Relevant today if not completed/cancelled and start/scheduled <= today (or absent).
 */
export const isRelevantToday = (task: TaskItem): boolean => {
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const start = task.start ? new Date(task.start) : null;
	const scheduled = task.scheduled ? new Date(task.scheduled) : null;
	if (task.completed || task.status === "-") return false;
	return (
		(!start && !scheduled) ||
		((!start || start <= today) && (!scheduled || scheduled <= today))
	);
};

/**
 * Extracts the target date from a 🎯 YYYY-MM-DD marker, or returns false if absent.
 * Returns the raw string "YYYY-MM-DD" if present.
 */
export const hasTargetDate = (task: TaskItem): string | false => {
	const txt = task?.text ?? "";
	const m = txt.match(
		new RegExp(`${escapeRegExp("🎯")}\\s*(${DateRe.source})`)
	);
	return m ? m[1] : false;
};