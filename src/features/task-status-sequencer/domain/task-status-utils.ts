/**
 * Normalize the checkbox token to `[<char>]` (no interior spaces).
 * Supports common status chars:
 *  - " " (space)  → open
 *  - "/"          → in-progress
 *  - "x"          → completed
 *  - "-"          → cancelled
 *
 * Note: Uppercase 'X' is not part of the accepted input type; callers should pass "x".
 */
export function setCheckboxStatusChar(
	line: string,
	newChar: "x" | "-" | "/" | " "
): string {
	// Match: prefix (up to "["), any internal status chars, then suffix (starting with "]")
	// This preserves all indentation, list markers, and everything after the checkbox.
	const m = line.match(/^(\s*(?:[-*+]|\d+[.)])\s*\[)[^\]]*(\].*)$/);
	if (!m) return line;
	return `${m[1]}${newChar}${m[2]}`;
}