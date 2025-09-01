/**
 * Escape a string for safe use in RegExp sources.
 * Example:
 *   escapeRegExp("a+b(c)") -> "a\\+b\\(c\\)"
 */
export function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
