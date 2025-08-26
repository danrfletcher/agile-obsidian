export function escapeHtml(s: string): string {
	return s.replace(
		/[&<>"']/g,
		(c) =>
			({
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				'"': "&quot;",
				"'": "&#39;",
			}[c as "&" | "<" | ">" | '"' | "'"])
	);
}

/**
 * markChip renders a <mark> with:
 * - data-template-id (stable key used by the engine)
 * - data-order-tag (classification only; no numeric order is used)
 * - optional data-kind and any extra attributes
 * - optional inline style for bg/color
 * If href is provided, the <mark> is wrapped by an <a class="internal-link">.
 */
export function markChip(opts: {
	id: string;
	kind?: string;
	orderTag?: string; // e.g., "artifact-item-type", "metadata-tag", "assignee", "parent-link"
	text: string; // inner text/html
	bg?: string;
	color?: string;
	bold?: boolean;
	href?: string;
	extraAttrs?: Record<string, string | number | boolean | undefined>;
}): string {
	const { id, kind, orderTag, text, bg, color, bold, href, extraAttrs } =
		opts;

	const styleParts: string[] = [];
	if (bg) styleParts.push(`background: ${escapeHtml(bg)};`);
	if (color) styleParts.push(`color: ${escapeHtml(color)};`);
	const styleAttr = styleParts.length
		? ` style="${styleParts.join(" ")}"`
		: "";

	const attrs: string[] = [
		`data-template-id="${escapeHtml(id)}"`,
		orderTag ? `data-order-tag="${escapeHtml(orderTag)}"` : "",
		kind ? `data-kind="${escapeHtml(kind)}"` : "",
	].filter(Boolean) as string[];

	if (extraAttrs) {
		for (const [k, v] of Object.entries(extraAttrs)) {
			if (v === undefined || v === false) continue;
			if (v === true) attrs.push(`${escapeHtml(k)}`);
			else attrs.push(`${escapeHtml(k)}="${escapeHtml(String(v))}"`);
		}
	}

	const content = bold ? `<strong>${text}</strong>` : text;
	const core = `<mark ${attrs.join(" ")}${styleAttr}>${content}</mark>`;
	return href
		? `<a class="internal-link" href="${escapeHtml(href)}">${core}</a>`
		: core;
}

export function taskLine(inner: string): string {
	return `- [ ] ${inner}`;
}

export function listLine(inner: string, indent = 0): string {
	const spaces = " ".repeat(indent);
	return `${spaces}- ${inner}`;
}

/**
 * Provide a stable wrapper around an entire template instance (both its mark and any tail text).
 * wrapper carries:
 * - data-template-wrapper: a random instance id (GUID-lite)
 * - data-template-key: the preset id like "agile.userStory"
 * - data-template-mark-id: the mark's data-template-id value (e.g., "agile-user-story")
 *
 * Consumers can event-delegate clicks to this wrapper to open param modals for edits.
 */
export function wrapTemplate(
	templateKey: string, // e.g., "agile.userStory"
	markId: string, // e.g., "agile-user-story" (the mark's data-template-id)
	innerHtml: string // the full template inner HTML (mark + any text)
): string {
	const instanceId = makeInstanceId();
	return `<span data-template-wrapper="${instanceId}" data-template-key="${escapeHtml(
		templateKey
	)}" data-template-mark-id="${escapeHtml(markId)}">${innerHtml}</span>`;
}

export function makeInstanceId(): string {
	// simple GUID-lite
	return (
		"tpl-" +
		Math.random().toString(36).slice(2, 9) +
		Date.now().toString(36)
	);
}
