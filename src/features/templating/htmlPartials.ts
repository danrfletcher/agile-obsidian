import tokensData from "./tokens.json";
import metaData from "./templateMeta.json";

function resolveToken(value: unknown): unknown {
	if (typeof value !== "string") return value;
	if (!value.startsWith("@")) return value;
	const path = value.slice(1).split(".");
	let cur: unknown = tokensData as unknown;
	for (const p of path) {
		if (
			cur &&
			typeof cur === "object" &&
			p in (cur as Record<string, unknown>)
		) {
			cur = (cur as Record<string, unknown>)[p];
		} else return value;
	}
	return cur;
}

export function resolveDefaults<T = Record<string, unknown>>(
	templateId: string
): T {
	const meta = (metaData as Record<string, unknown>)[
		templateId as keyof typeof metaData
	] as { defaults?: Record<string, unknown> } | undefined;
	const defaults = (meta?.defaults ?? {}) as Record<string, unknown>;
	const resolved: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(defaults))
		resolved[k] = resolveToken(v);
	return resolved as T;
}

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
