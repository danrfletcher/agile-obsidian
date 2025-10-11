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

function findAllTemplateWrappersRanges(
	html: string
): Array<{ start: number; end: number }> {
	const ranges: Array<{ start: number; end: number }> = [];
	let i = 0;
	const n = html.length;

	while (i < n) {
		// Find next '<'
		const openIdx = html.indexOf("<", i);
		if (openIdx === -1) break;

		// If it's not an opening span, skip this tag
		if (!isOpeningSpanAt(html, openIdx)) {
			const tagEnd = findTagEnd(html, openIdx);
			i = tagEnd + 1;
			continue;
		}

		// Find end of opening tag '>'
		const openEnd = findTagEnd(html, openIdx);
		const openTag = html.slice(openIdx, openEnd + 1);

		// Does this opening span carry data-template-key?
		const isTemplateWrapper = tagHasAttr(openTag, "data-template-key");

		// If not a template wrapper, continue scanning after this tag
		if (!isTemplateWrapper) {
			i = openEnd + 1;
			continue;
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

			// Opening or closing span?
			if (isOpeningSpanAt(html, lt)) {
				const tagEnd = findTagEnd(html, lt);
				depth += 1;
				j = tagEnd + 1;
			} else if (isClosingSpanAt(html, lt)) {
				const tagEnd = findTagEnd(html, lt);
				depth -= 1;
				j = tagEnd + 1;
			} else {
				// Some other tag, skip it safely
				const tagEnd = findTagEnd(html, lt);
				j = tagEnd + 1;
			}
		}

		const end = j;
		ranges.push({ start: openIdx, end });
		i = end; // continue after the wrapper
	}

	return ranges;
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
