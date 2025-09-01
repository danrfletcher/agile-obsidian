/**
 * Domain types and constants for task filtering and agile artifact classification.
 *
 * Centralizes:
 * - Branded union types for artifact categories
 * - Task status semantics (if not already exported by @features/tasks)
 * - Emoji tokens and tag/class tokens used by filters
 * - Common regex fragments
 */

export type AgileArtifactType =
	| "initiative"
	| "learning-initiative"
	| "epic"
	| "learning-epic"
	| "story"
	| "okr"
	| "recurring-responsibility"
	| "task";

/**
 * Known TaskItem status codes.
 * If @features/tasks exports a canonical enum, prefer importing that.
 */
export enum TaskStatusCode {
	Open = "O",
	Done = "d",
	Category = "A",
	// Add other known codes here as needed, ensuring clear semantics.
}

/**
 * Tokens and markers used within task text.
 */
export const Tokens = {
	CompletedEmoji: "✅",
	CancelledEmoji: "❌",
	SnoozeEmoji: "💤",
	SnoozeInheritedMarker: "⬇️",
	ActivePrefix: "active-",
	InactivePrefix: "inactive-",
	ActiveTeamClass: "active-team",
} as const;

/**
 * Strict regex for YYYY-MM-DD validation.
 */
export const DateRe =
	/^(?<y>\d{4})-(?<m>0[1-9]|1[0-2])-(?<d>0[1-9]|[12]\d|3[01])$/;

/**
 * Parse a date in YYYY-MM-DD into a Date at midnight local time.
 * Returns null if invalid.
 */
export function parseYyyyMmDd(dateStr?: string | null): Date | null {
	if (!dateStr) return null;
	const m = DateRe.exec(dateStr);
	if (!m || !m.groups) return null;
	const year = Number(m.groups.y);
	const month = Number(m.groups.m);
	const day = Number(m.groups.d);
	const dt = new Date(year, month - 1, day);
	if (isNaN(dt.getTime())) return null;
	dt.setHours(0, 0, 0, 0);
	// Guard against JS Date overflow silently adjusting (e.g., 2025-02-31)
	if (
		dt.getFullYear() !== year ||
		dt.getMonth() !== month - 1 ||
		dt.getDate() !== day
	) {
		return null;
	}
	return dt;
}

/**
 * Return today's date at midnight local time.
 */
export function todayAtMidnight(): Date {
	const t = new Date();
	t.setHours(0, 0, 0, 0);
	return t;
}
