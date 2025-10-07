/**
 * Normalize the visible part of a task line for matching.
 */
export function normalizeVisibleText(s: string): string {
	return (s || "")
		.replace(/\s*(✅|❌)\s+\d{4}-\d{2}-\d{2}\b/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Very conservative sanitization for user slugs embedded in inline HTML markers in Markdown.
 * Allows alphanumerics, hyphen, underscore, and dot. Strips everything else.
 */
export function sanitizeUserSlug(slug: string): string {
	return (slug || "").toLowerCase().replace(/[^a-z0-9._-]/g, "");
}
