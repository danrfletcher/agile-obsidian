/**
 * Custom template pattern language (G14), parsed by a hand-written tokenizer.
 *
 *   {{name}}                 inserts the field's value
 *   {{#name}} ... {{/name}}  renders its content only when the field's value is non-empty
 *
 * The pattern is data: it is turned into a list of nodes and walked by the renderer. It is
 * never compiled to code, evaluated or imported (F3). Sections cannot nest and the pattern
 * must be a single line.
 */

export interface PatternText {
	kind: "text";
	value: string;
}
export interface PatternVar {
	kind: "var";
	name: string;
}
export type PatternLeaf = PatternText | PatternVar;
export interface PatternSection {
	kind: "section";
	name: string;
	children: PatternLeaf[];
}
export type PatternNode = PatternLeaf | PatternSection;

export interface PatternParseResult {
	nodes: PatternNode[];
	/** Messages for the `text` key; empty when the pattern is valid. */
	errors: string[];
	/** Field names referenced by `{{name}}` or `{{#name}}`. */
	used: Set<string>;
}

/** Field names, as used in tags and in `data-tpl-var`. Never starts with `_`, so no `__proto__`. */
export const FIELD_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;

export function parsePattern(
	text: string,
	fieldNames: ReadonlySet<string>
): PatternParseResult {
	const nodes: PatternNode[] = [];
	const errors: string[] = [];
	const used = new Set<string>();

	if (/[\r\n]/.test(text)) {
		errors.push("must be a single line (no newlines)");
	}

	let section: PatternSection | null = null;
	// Depth of nested section tags that were reported and are being skipped.
	let skippedDepth = 0;

	const pushText = (value: string) => {
		if (!value) return;
		const target = section ? section.children : nodes;
		const last = target[target.length - 1];
		if (last && last.kind === "text") last.value += value;
		else target.push({ kind: "text", value });
	};

	let pos = 0;
	while (pos < text.length) {
		const open = text.indexOf("{{", pos);
		if (open === -1) {
			pushText(text.slice(pos));
			break;
		}
		pushText(text.slice(pos, open));

		const close = text.indexOf("}}", open + 2);
		if (close === -1) {
			errors.push(`unclosed "{{" at position ${open}`);
			break;
		}
		pos = close + 2;

		const tag = text.slice(open + 2, close).trim();
		if (tag === "") {
			errors.push(`empty tag at position ${open}`);
			continue;
		}

		if (tag.startsWith("#")) {
			const name = tag.slice(1).trim();
			if (!FIELD_NAME_RE.test(name)) {
				errors.push(`invalid section tag "{{${tag}}}"`);
				continue;
			}
			if (section || skippedDepth > 0) {
				errors.push(
					`sections cannot be nested ("{{#${name}}}" inside "{{#${
						section?.name ?? "…"
					}}}")`
				);
				skippedDepth += 1;
				continue;
			}
			if (!fieldNames.has(name)) {
				errors.push(`"{{#${name}}}" has no matching field`);
			} else {
				used.add(name);
			}
			section = { kind: "section", name, children: [] };
			continue;
		}

		if (tag.startsWith("/")) {
			const name = tag.slice(1).trim();
			if (skippedDepth > 0) {
				skippedDepth -= 1;
				continue;
			}
			if (!section) {
				errors.push(`"{{/${name}}}" has no matching "{{#${name}}}"`);
				continue;
			}
			if (section.name !== name) {
				errors.push(
					`"{{#${section.name}}}" is closed by "{{/${name}}}"`
				);
			}
			nodes.push(section);
			section = null;
			continue;
		}

		if (!FIELD_NAME_RE.test(tag)) {
			errors.push(`invalid tag "{{${tag}}}"`);
			continue;
		}
		if (!fieldNames.has(tag)) {
			errors.push(`"{{${tag}}}" has no matching field`);
			continue;
		}
		used.add(tag);
		const leaf: PatternVar = { kind: "var", name: tag };
		if (section) section.children.push(leaf);
		else nodes.push(leaf);
	}

	if (section) {
		errors.push(`"{{#${section.name}}}" is never closed`);
		nodes.push(section);
	}

	return { nodes, errors, used };
}
