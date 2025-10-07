/**
 * Domain: Task status sequencing (pure).
 */
export type StatusChar = " " | "x" | "-" | "/";

/**
 * Default circular sequence for task statuses when clicking a checkbox:
 *   " " → "/" → "x" → "-" → " " → ...
 */
export const DEFAULT_STATUS_SEQUENCE: ReadonlyArray<StatusChar> = [
	" ",
	"/",
	"x",
	"-",
];

/**
 * Normalize a status-like input into a canonical single-char string.
 * - Treats "" (empty) as " " (unchecked)
 * - Downcases "X" to "x"
 */
export function normalizeStatusInput(
	current: string | null | undefined
): string {
	const s = (current ?? "").toString().toLowerCase();
	if (s === "" || s === " ") return " ";
	if (s === "x" || s === "-" || s === "/") return s;
	return s.length === 1 ? s : " ";
}

/**
 * Return the next status char in a circular sequence.
 * If current is not found (including ""), start from " ".
 */
export function getNextStatusChar(
	current: string | null | undefined,
	sequence: ReadonlyArray<StatusChar> = DEFAULT_STATUS_SEQUENCE
): StatusChar {
	const norm = normalizeStatusInput(current);
	const idx = sequence.findIndex((c) => c === norm);
	if (idx < 0) return sequence[0];
	const next = (idx + 1) % sequence.length;
	return sequence[next];
}
