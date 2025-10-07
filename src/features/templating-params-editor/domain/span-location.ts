/**
 * Span location and deterministic matching utilities.
 * These functions are pure and safe to unit test.
 */

export function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Given the file content and the absolute index of an opening <span ...>,
 * find the absolute end index (exclusive) of its matching </span>, accounting for nested spans.
 * Returns -1 if not found.
 */
export function findMatchingSpanEndIndexDeterministic(
	s: string,
	startIdx: number
): number {
	const lower = s.toLowerCase();
	if (lower.slice(startIdx, startIdx + 5) !== "<span") {
		const firstOpen = lower.indexOf("<span", startIdx);
		if (firstOpen === -1) return -1;
		startIdx = firstOpen;
	}
	const firstGt = s.indexOf(">", startIdx);
	if (firstGt === -1) return -1;

	let depth = 1;
	let i = firstGt + 1;
	while (i < s.length) {
		const nextOpen = lower.indexOf("<span", i);
		const nextClose = lower.indexOf("</span>", i);
		if (nextClose === -1) return -1;

		if (nextOpen !== -1 && nextOpen < nextClose) {
			const gt = s.indexOf(">", nextOpen);
			if (gt === -1) return -1;
			depth += 1;
			i = gt + 1;
			continue;
		}
		depth -= 1;
		const closeEnd = nextClose + "</span>".length;
		if (depth === 0) return closeEnd;
		i = closeEnd;
	}
	return -1;
}

export function offsetOfLineStart(lines: string[], lineNo: number): number {
	let off = 0;
	for (let i = 0; i < lineNo; i++) {
		off += lines[i].length + 1; // include newline
	}
	return off;
}

/**
 * Locate a wrapper block by unique instance id.
 * Returns [startIndex, endIndexExclusive] or null.
 */
export function locateByInstanceId(
	content: string,
	instanceId: string
): [number, number] | null {
	const re = new RegExp(
		`<span\\b[^>]*\\bdata-template-wrapper\\s*=\\s*"` +
			escapeRegExp(instanceId) +
			`"[\\s\\S]*?>`,
		"i"
	);
	const m = re.exec(content);
	if (!m || typeof m.index !== "number") return null;
	const startIndex = m.index;
	const endIndex = findMatchingSpanEndIndexDeterministic(content, startIndex);
	if (endIndex === -1) return null;
	return [startIndex, endIndex];
}

/**
 * Locate a wrapper block by template key near a specific line number (lineHint0 and neighbors).
 * Returns [startIndex, endIndexExclusive] or null.
 */
export function locateNearLineByKey(
	content: string,
	templateKey: string,
	lineHint0: number
): [number, number] | null {
	const lines = content.split(/\r?\n/);
	const idxs = [lineHint0, lineHint0 - 1, lineHint0 + 1].filter(
		(i) => i >= 0 && i < lines.length
	);
	const re = new RegExp(
		`<span\\b[^>]*\\bdata-template-key\\s*=\\s*"` +
			escapeRegExp(templateKey) +
			`"[\\s\\S]*?>`,
		"i"
	);
	for (const li of idxs) {
		const line = lines[li];
		const m = re.exec(line);
		if (!m) continue;
		const openIdx = m.index;
		const absStart = offsetOfLineStart(lines, li) + openIdx;
		const absEnd = findMatchingSpanEndIndexDeterministic(content, absStart);
		if (absEnd !== -1) {
			return [absStart, absEnd];
		}
	}
	return null;
}

/**
 * Locate the first wrapper block in the entire file by template key.
 * Returns [startIndex, endIndexExclusive] or null.
 */
export function locateFirstByKey(
	content: string,
	templateKey: string
): [number, number] | null {
	const re = new RegExp(
		`<span\\b[^>]*\\bdata-template-key\\s*=\\s*"` +
			escapeRegExp(templateKey) +
			`"[\\s\\S]*?>`,
		"i"
	);
	const m = re.exec(content);
	if (!m || typeof m.index !== "number") return null;
	const startIndex = m.index;
	const endIndex = findMatchingSpanEndIndexDeterministic(content, startIndex);
	if (endIndex === -1) return null;
	return [startIndex, endIndex];
}
