import { escapeHtml } from "@utils";

/**
 * markChip renders a <mark> with optional style/attrs.
 * Note: data-order-tag is NOT placed on the mark; it belongs on the wrapper.
 */
export function markChip(opts: {
	id: string;
	kind?: string;
	text: string;
	bg?: string;
	color?: string;
	bold?: boolean;
	href?: string;
	extraAttrs?: Record<string, string | number | boolean | undefined>;
}): string {
	const { kind, text, bg, color, bold, href, extraAttrs } = opts;

	const styleParts: string[] = [];
	if (bg) styleParts.push(`background: ${escapeHtml(bg)};`);
	if (color) styleParts.push(`color: ${escapeHtml(color)};`);
	const styleAttr = styleParts.length
		? ` style="${styleParts.join(" ")}"`
		: "";

	const attrs: string[] = [];
	if (kind) {
		attrs.push(`data-kind="${escapeHtml(kind)}"`);
	}

	if (extraAttrs) {
		for (const [k, v] of Object.entries(extraAttrs)) {
			if (v === undefined || v === false) continue;
			if (v === true) {
				attrs.push(`${escapeHtml(k)}`);
			} else {
				attrs.push(`${escapeHtml(k)}="${escapeHtml(String(v))}"`);
			}
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

// Helper to convert camelCase/PascalCase/space/underscore to kebab-case
function toKebabCase(input: string): string {
	return input
		.replace(/([a-z0-9])([A-Z])/g, "$1-$2") // camelCase -> camel-Case
		.replace(/[_\s]+/g, "-") // spaces/underscores -> -
		.toLowerCase();
}

/**
 * Wraps a template instance.
 * Update: Accepts an optional `props` object. Each key/value is emitted as
 * data-{kebab-cased-key}="{escaped value}" on the wrapper span.
 */
export function wrapTemplate(
	templateKey: string,
	innerHtml: string,
	props?: Record<string, unknown>
): string {
	const instanceId = makeInstanceId();

	const dataAttrs =
		props && typeof props === "object"
			? Object.entries(props)
					.filter(([, v]) => v != null)
					.map(([k, v]) => {
						const kebabKey = toKebabCase(k);
						const value =
							typeof v === "string"
								? v
								: typeof v === "number" || typeof v === "boolean"
								? String(v)
								: JSON.stringify(v);
						return ` data-${kebabKey}="${escapeHtml(value)}"`;
					})
					.join("")
			: "";

	return `<span data-template-wrapper="${instanceId}" data-template-key="${escapeHtml(
		templateKey
	)}"${dataAttrs}>${innerHtml}</span>`;
}

export function makeInstanceId(): string {
	return (
		"tpl-" +
		Math.random().toString(36).slice(2, 9) +
		Date.now().toString(36)
	);
}