import { TaskItem } from "@features/task-index";
import { escapeRegExp } from "@utils";
import { DateRe, parseYyyyMmDd } from "./types";

/**
 * Format a Date (local) into YYYY-MM-DD.
 */
export function toYyyyMmDd(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

/**
 * Relevant today if not completed/cancelled and start/scheduled <= today (or absent).
 */
export const isRelevantToday = (task: TaskItem): boolean => {
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const start = task.start ? new Date(task.start) : null;
	const scheduled = task.scheduled ? new Date(task.scheduled) : null;
	if (task.completed || task.status === "-") return false;
	const startOk = !start || start <= today;
	const scheduledOk = !scheduled || scheduled <= today;

	return startOk && scheduledOk;
};

/**
 * Internal: remove ^ and $ anchors from DateRe so we can embed it.
 */
const INNER_DATE_RE = DateRe.source.replace(/^\^/, "").replace(/\$$/, "");

/**
 * Internal: parse a YYYY-MM-DD date string safely to Date at local midnight.
 */
function parseDateStr(dateStr?: string | null): Date | null {
	return parseYyyyMmDd(dateStr ?? null);
}

/**
 * Internal: find the first YYYY-MM-DD following any of the provided markers.
 */
function matchDateAfterAnyMarker(txt: string, markers: string[]): Date | null {
	if (!txt) return null;
	for (const mk of markers) {
		const re = new RegExp(
			`${escapeRegExp(mk)}\\s*(${INNER_DATE_RE})\\b`,
			"u"
		);
		const m = txt.match(re);
		if (m && m[1]) {
			const dt = parseDateStr(m[1]);
			if (dt) return dt;
		}
	}
	return null;
}

/**
 * Extracts the target date from a 🎯 YYYY-MM-DD marker, or returns null if absent.
 * Returns a Date object at local midnight if present.
 */
export const getTargetDate = (task: TaskItem): Date | null => {
	const txt = task?.text ?? "";
	return matchDateAfterAnyMarker(txt, ["🎯"]);
};

/**
 * Extracts the completed date from a ✅ YYYY-MM-DD marker, or returns null if absent.
 */
export const getCompletedDate = (task: TaskItem): Date | null => {
	const txt = task?.text ?? "";
	return matchDateAfterAnyMarker(txt, ["✅"]);
};

/**
 * Extracts the cancelled date from a ❌ YYYY-MM-DD marker, or returns null if absent.
 */
export const getCancelledDate = (task: TaskItem): Date | null => {
	const txt = task?.text ?? "";
	return matchDateAfterAnyMarker(txt, ["❌"]);
};

/**
 * Extracts the start date from a 🛫 YYYY-MM-DD marker, or returns null if absent.
 */
export const getStartDate = (task: TaskItem): Date | null => {
	const txt = task?.text ?? "";
	return matchDateAfterAnyMarker(txt, ["🛫"]);
};

/**
 * Extracts the scheduled date from a ⏳ YYYY-MM-DD marker, or returns null if absent.
 */
export const getScheduledDate = (task: TaskItem): Date | null => {
	const txt = task?.text ?? "";
	return matchDateAfterAnyMarker(txt, ["⏳"]);
};

/**
 * Extracts the due date from a 📅 YYYY-MM-DD marker, or returns null if absent.
 * Note: This specifically looks for a date form after 📅 to avoid confusion
 * with schedule text (e.g., "📅 Weekdays").
 */
export const getDueDate = (task: TaskItem): Date | null => {
	const txt = task?.text ?? "";
	return matchDateAfterAnyMarker(txt, ["📅"]);
};

/**
 * Schedule parsing: detect day-of-week schedules like:
 * - "🗓️ Sundays" / "🗓️ Sunday" (case-insensitive)
 * - "🗓 Sundays:" (with punctuation)
 * - "🗓️ Mon-Fri", "🗓️ Monday–Friday", "🗓️ Weekdays"
 * - "🗓️ Weekends" (Sat + Sun)
 * - "🗓️ Daily", "🗓️ Every day"
 * - Lists: "🗓️ Mon, Wed, Fri", "🗓️ Tuesday and Thursday"
 *
 * Notes:
 * - We only parse up to the next markup "<" to avoid pulling in HTML tags.
 * - Multiple calendar markers are supported; if any includes today, we return true.
 * - We accept both 🗓 and 🗓️ (with VS16) and common alternatives 📅, 📆
 */
const DOW_NAMES: Record<string, number> = {
	sun: 0,
	sunday: 0,
	mon: 1,
	monday: 1,
	tue: 2,
	tues: 2,
	tuesday: 2,
	wed: 3,
	weds: 3,
	wednesday: 3,
	thu: 4,
	thur: 4,
	thurs: 4,
	thursday: 4,
	fri: 5,
	friday: 5,
	sat: 6,
	saturday: 6,
};

function normalizeWord(w: string): string {
	return w.toLowerCase().replace(/[^a-z]/g, "");
}

function expandRange(start: number, end: number): number[] {
	// Inclusive, circular week
	const out: number[] = [];
	let cur = start;
	out.push(cur);
	while (cur !== end) {
		cur = (cur + 1) % 7;
		out.push(cur);
	}
	return out;
}

function parseScheduleChunk(rawChunk: string): Set<number> {
	const days = new Set<number>();
	const raw = rawChunk.toLowerCase().trim();

	// Simple buckets
	if (/\bdaily\b|\bevery\s*day\b/.test(raw)) {
		[0, 1, 2, 3, 4, 5, 6].forEach((d) => days.add(d));
		return days;
	}
	if (
		/\bweekdays?\b/.test(raw) ||
		/\bmonday\s*[-–]\s*friday\b/.test(raw) ||
		/\bmon\s*[-–]\s*fri\b/.test(raw)
	) {
		[1, 2, 3, 4, 5].forEach((d) => days.add(d));
		return days;
	}
	if (
		/\bweekends?\b/.test(raw) ||
		/\bsat\s*[-–]\s*sun\b/.test(raw) ||
		/\bsaturday\s*[-–]\s*sunday\b/.test(raw)
	) {
		[6, 0].forEach((d) => days.add(d));
		return days;
	}

	// Ranges like "Mon–Fri", "Thu-Sun"
	const rangeRe =
		/(sun|sunday|mon|monday|tue|tues|tuesday|wed|weds|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday)\s*[-–]\s*(sun|sunday|mon|monday|tue|tues|tuesday|wed|weds|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday)/gi;
	for (const m of raw.matchAll(rangeRe)) {
		const a = DOW_NAMES[normalizeWord(m[1])];
		const b = DOW_NAMES[normalizeWord(m[2])];
		if (a !== undefined && b !== undefined) {
			expandRange(a, b).forEach((d) => days.add(d));
		}
	}

	// Expressions like "Every Sunday", "On Tuesday and Thursday"
	const cleaned = raw
		.replace(/\bevery\b/gi, " ")
		.replace(/\bon\b/gi, " ")
		.replace(/[:.;,]+/g, " ");

	// Individual days list: split on commas/and/slashes/spaces and collect
	const tokens = cleaned
		.split(/[,/]|(?:\band\b)/gi)
		.flatMap((t) => t.split(/\s+/))
		.map((t) => normalizeWord(t.replace(/s\b/, ""))) // remove trailing plural 's'
		.filter(Boolean);

	for (const tok of tokens) {
		const d = DOW_NAMES[tok];
		if (d !== undefined) days.add(d);
	}

	return days;
}

/**
 * Extract the human-readable recurring pattern text(s) after any calendar marker.
 * - Accepts 🗓️, 🗓, 📅, 📆
 * - Captures until markup "<" or newline
 * - Skips chunks that start with a date (e.g., "📅 2025-06-07" is treated as a due date, not a pattern)
 * - Returns a single string joining multiple chunks with "; ", or null if none
 */
export function getRecurringPattern(task: TaskItem): string | null {
	const txt = task?.text ?? "";
	if (!txt) return null;

	const re = /(?:🗓️|🗓|📅|📆)\s*([^<\n\r]*)/giu;
	const out: string[] = [];
	const startsWithDate = new RegExp(`^${INNER_DATE_RE}\\b`, "u");

	for (const m of txt.matchAll(re)) {
		const chunk = (m[1] ?? "").trim();
		if (!chunk) continue;
		// If the chunk looks like a date, skip (that's likely a due date usage of 📅)
		if (startsWithDate.test(chunk)) continue;
		out.push(chunk);
	}

	if (out.length === 0) return null;

	// Deduplicate case-insensitively while preserving first occurrence casing
	const dedup: string[] = [];
	const seen = new Set<string>();
	for (const c of out) {
		const key = c.toLowerCase();
		if (!seen.has(key)) {
			seen.add(key);
			dedup.push(c);
		}
	}
	return dedup.join("; ");
}

/**
 * True if any recurring pattern on the task matches today's day-of-week.
 */
export function recurringPatternMatchesToday(
	task: TaskItem,
	date = new Date()
): boolean {
	const txt = task?.text ?? "";
	if (!txt) return false;

	// Match any of the accepted calendar markers followed by the schedule text until markup/newline
	const re = /(?:🗓️|🗓|📅|📆)\s*([^<\n\r]*)/giu;

	const today = date.getDay(); // 0=Sun ... 6=Sat
	const startsWithDate = new RegExp(`^${INNER_DATE_RE}\\b`, "u");

	for (const m of txt.matchAll(re)) {
		const chunk = (m[1] ?? "").trim();
		if (!chunk) continue;
		// Ignore chunks that start with a date (likely due date usage)
		if (startsWithDate.test(chunk)) continue;

		const days = parseScheduleChunk(chunk);
		if (days.has(today)) {
			return true;
		}
	}
	return false;
}
