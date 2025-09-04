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
