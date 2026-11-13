/**
 * Robust utilities for finding and removing wrapper spans that contain
 * data-template-key="...". These wrappers may contain nested <span> tags,
 * so we cannot rely on a simple non-greedy regex. We scan and balance spans.
 * Pure, framework-agnostic logic (belongs in domain, not UI).
 */

function tagHasAttr(openTag: string, attrName: string): boolean {
	// Case-insensitive attribute presence check; assumes standard quoting
	// e.g. data-template-key="..."
	const re = new RegExp(`\\b${attrName}\\s*=`, "i");
	return re.test(openTag);
}

function findTagEnd(html: string, startIdx: number): number {
	// Finds the '>' that ends a tag starting at startIdx (where html[startIdx] === '<'),
	// taking into account quoted attribute values that may contain '>'.
	// If the tag is never closed, returns html.length - 1 (end of string). Callers that
	// need to know whether the tag really ended use tagEndsAt().
	let i = startIdx;
	let inSingle = false;
	let inDouble = false;
	while (i < html.length) {
		const ch = html[i];
		if (ch === "'" && !inDouble) {
			inSingle = !inSingle;
		} else if (ch === '"' && !inSingle) {
			inDouble = !inDouble;
		} else if (ch === ">" && !inSingle && !inDouble) {
			return i;
		}
		i++;
	}
	return html.length - 1; // fallback: end of string
}

/**
 * A '<' only starts a tag when a tag name, '/', '!' or '?' follows. A bare '<' in task
 * text (`a < b`, `x <= y`) is plain text; treating it as a tag would hide every chip
 * after it from the scanner.
 */
function isTagStartAt(html: string, idx: number): boolean {
	return /[A-Za-z/!?]/.test(html[idx + 1] ?? "");
}

function isOpeningSpanAt(html: string, idx: number): boolean {
	// Case-insensitive check for "<span" at idx
	if (!(idx >= 0 && idx + 5 <= html.length && html[idx] === "<"))
		return false;
	const probe = html.slice(idx + 1, idx + 5);
	return (
		probe === "span" || probe === "SPAN" || probe.toLowerCase() === "span"
	);
}

function isClosingSpanAt(html: string, idx: number): boolean {
	// Case-insensitive check for "</span" at idx
	if (!(idx >= 0 && idx + 6 <= html.length && html[idx] === "<"))
		return false;
	const probe = html.slice(idx + 1, idx + 6);
	return (
		probe === "/span" ||
		probe === "/SPAN" ||
		probe.toLowerCase() === "/span"
	);
}

/** True when findTagEnd's result is a real closing '>' (not the end-of-string fallback). */
function tagEndsAt(html: string, tagEnd: number): boolean {
	return html[tagEnd] === ">";
}

type WrapperScan = {
	ranges: Array<{ start: number; end: number }>;
	/**
	 * False when a template wrapper (or a tag inside one) is never closed, so the scan
	 * had to fall back to "the rest of the string". Callers that reorder or rewrite text
	 * must treat an unbalanced scan as "do not touch this line": the fallback range would
	 * otherwise swallow the task text that follows the broken chip.
	 */
	balanced: boolean;
};

function scanTemplateWrappers(html: string): WrapperScan {
	const ranges: Array<{ start: number; end: number }> = [];
	let balanced = true;
	let i = 0;
	const n = html.length;

	while (i < n) {
		// Find next '<'
		const openIdx = html.indexOf("<", i);
		if (openIdx === -1) break;

		// A bare '<' in text is not a tag: step over just that character
		if (!isTagStartAt(html, openIdx)) {
			i = openIdx + 1;
			continue;
		}

		// If it's not an opening span, skip this tag
		if (!isOpeningSpanAt(html, openIdx)) {
			const tagEnd = findTagEnd(html, openIdx);
			i = tagEnd + 1;
			continue;
		}

		// Find end of opening tag '>'
		const openEnd = findTagEnd(html, openIdx);
		const openTag = html.slice(openIdx, openEnd + 1);
		const openTagClosed = tagEndsAt(html, openEnd);

		// Does this opening span carry data-template-key?
		const isTemplateWrapper = tagHasAttr(openTag, "data-template-key");

		// If not a template wrapper, continue scanning after this tag
		if (!isTemplateWrapper) {
			i = openEnd + 1;
			continue;
		}

		if (!openTagClosed) {
			// Wrapper opening tag never ends: nothing after it can be trusted.
			balanced = false;
			ranges.push({ start: openIdx, end: n });
			break;
		}

		// Balance nested spans starting after opening tag
		let depth = 1;
		let j = openEnd + 1;

		while (j < n && depth > 0) {
			const lt = html.indexOf("<", j);
			if (lt === -1) {
				// Unbalanced; take rest of string
				j = n;
				break;
			}

			// A bare '<' inside a chip's text is not a tag
			if (!isTagStartAt(html, lt)) {
				j = lt + 1;
				continue;
			}

			// Opening or closing span?
			const tagEnd = findTagEnd(html, lt);
			if (!tagEndsAt(html, tagEnd)) {
				// A tag inside the wrapper never ends.
				j = n;
				break;
			}
			if (isOpeningSpanAt(html, lt)) {
				depth += 1;
			} else if (isClosingSpanAt(html, lt)) {
				depth -= 1;
			}
			// Any other tag is skipped safely.
			j = tagEnd + 1;
		}

		if (depth > 0) balanced = false;

		const end = j;
		ranges.push({ start: openIdx, end });
		i = end; // continue after the wrapper
	}

	return { ranges, balanced };
}

function findAllTemplateWrappersRanges(
	html: string
): Array<{ start: number; end: number }> {
	return scanTemplateWrappers(html).ranges;
}

/**
 * True when every template wrapper in `html` is properly closed. When false, the
 * ranges returned by the other helpers for the broken wrapper run to the end of the
 * string and must not be moved or rewritten.
 */
export function hasBalancedWrappers(html: string): boolean {
	return scanTemplateWrappers(html).balanced;
}

/**
 * Splits `html` into alternating plain-text and wrapper segments, in order, so callers
 * can transform the plain text without ever touching chip HTML. Concatenating the
 * `text` of every segment gives back `html` exactly.
 */
export function splitByWrappers(
	html: string
): Array<{ text: string; wrapper: boolean }> {
	const { ranges } = scanTemplateWrappers(html);
	const out: Array<{ text: string; wrapper: boolean }> = [];
	let cursor = 0;
	for (const r of ranges) {
		if (cursor < r.start) {
			out.push({ text: html.slice(cursor, r.start), wrapper: false });
		}
		out.push({ text: html.slice(r.start, r.end), wrapper: true });
		cursor = r.end;
	}
	if (cursor < html.length) {
		out.push({ text: html.slice(cursor), wrapper: false });
	}
	return out;
}

export function findAllWrappers(html: string): string[] {
	const ranges = findAllTemplateWrappersRanges(html);
	if (!ranges.length) return [];
	return ranges.map((r) => html.slice(r.start, r.end));
}

export function removeWrappersByTemplate(html: string): {
	withoutWrappers: string;
	removedWrappers: string[];
} {
	const ranges = findAllTemplateWrappersRanges(html);
	if (!ranges.length) {
		return { withoutWrappers: html, removedWrappers: [] };
	}

	const removed: string[] = [];
	let out = "";
	let cursor = 0;

	for (const r of ranges) {
		// Append text before this wrapper
		if (cursor < r.start) out += html.slice(cursor, r.start);
		// Replace the wrapper content with a single space
		out += " ";
		// Collect removed wrapper
		removed.push(html.slice(r.start, r.end));
		// Advance cursor to end of wrapper
		cursor = r.end;
	}

	// Append any remaining text
	if (cursor < html.length) out += html.slice(cursor);

	return { withoutWrappers: out, removedWrappers: removed };
}
