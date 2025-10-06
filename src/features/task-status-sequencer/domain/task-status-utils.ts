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
    // Match list marker and checkbox, replace inner char with provided newChar
    return line.replace(
        /^(\s*(?:[-*+]|\d+[.)])\s*\[)\s*[^\]]?\s*(\])/,
        (_m, p1: string, p2: string) => `${p1}${newChar}${p2}`
    );
}