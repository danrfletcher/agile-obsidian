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
	// Match: prefix (indent + list marker + space + "["), any inner content with spaces, closing "]", then the rest.
	const m = line.match(
		/^(\s*(?:[-*+]|\d+[.)])\s*\[)\s*[^\]]?\s*(\])(.*)$/
	);
	if (!m) return line;
	const prefix = m[1] ?? "";
	const suffixBracket = m[2] ?? "]";
	const tail = m[3] ?? "";
	return `${prefix}${newChar}${suffixBracket}${tail}`;
}