/**
 * Domain: String-level line helpers for checkbox tasks.
 *
 * Note: Uses platform helper to read current checkbox char; write is local.
 */
import { getCheckboxStatusChar } from "@platform/obsidian";
import { setCheckboxStatusChar } from "./task-status-utils";
import {
	DEFAULT_STATUS_SEQUENCE,
	getNextStatusChar,
	type StatusChar,
} from "./task-status-sequence";

/**
 * Produce a new line string with the checkbox status advanced to the next char.
 * Returns the updated line (or the original if not a task line).
 */
export function updateLineWithNextStatus(
	line: string,
	sequence: ReadonlyArray<StatusChar> = DEFAULT_STATUS_SEQUENCE
): string {
	const present = getCheckboxStatusChar(line);
	if (present == null) return line;
	const next = getNextStatusChar(present, sequence);
	return setCheckboxStatusChar(line, next);
}

/**
 * Compute the next status for a given checkbox line string (without mutating).
 */
export function computeDesiredNextFromLine(
	line: string,
	sequence: ReadonlyArray<StatusChar> = DEFAULT_STATUS_SEQUENCE
): StatusChar {
	const present = getCheckboxStatusChar(line);
	return getNextStatusChar(present, sequence);
}
