// Utilities for scanning and modifying inline assignment wrappers on a single editor line.

export type InlineAssignmentWrapper = {
	start: number; // index of '<span' start (inclusive)
	end: number; // index after the matching '</span>' (exclusive)
	instanceId: string | null; // data-template-wrapper value
	assignType: "assignee" | "delegate" | null; // data-assign-type
	segment: string; // substring for convenience
};

/**
 * Deterministic scanner: starting at the given '<span ...>' opening tag, walk the line
 * and count '<span' vs '</span>' to find the matching closing position.
 * This avoids regex corner cases with nested spans.
 */
function findMatchingSpanEndIndexDeterministic(
	s: string,
	startIdx: number
): number {
	// Sanity: the startIdx must point at an opening '<span'
	if (s.slice(startIdx, startIdx + 5).toLowerCase() !== "<span") {
		const firstOpen = s.toLowerCase().indexOf("<span", startIdx);
		if (firstOpen === -1) return -1;
		startIdx = firstOpen;
	}

	const firstGt = s.indexOf(">", startIdx);
	if (firstGt === -1) return -1;

	let depth = 1;
	let i = firstGt + 1;

	while (i < s.length) {
		const nextOpen = s.toLowerCase().indexOf("<span", i);
		const nextClose = s.toLowerCase().indexOf("</span>", i);

		if (nextClose === -1) return -1;

		if (nextOpen !== -1 && nextOpen < nextClose) {
			depth += 1;
			const gt = s.indexOf(">", nextOpen);
			if (gt === -1) return -1;
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

function getAttr(segment: string, attr: string): string | null {
	// Matches data-attr="..."; allow single quotes too
	const re = new RegExp(`\\b${attr}\\s*=\\s*"(.*?)"`, "i");
	let m = re.exec(segment);
	if (m) return m[1] ?? null;
	const re2 = new RegExp(`\\b${attr}\\s*=\\s*'(.*?)'`, "i");
	m = re2.exec(segment);
	return m ? m[1] ?? null : null;
}

/**
 * Find all <span ... data-template-key="members.assignee" ...>...</span> wrappers on this line.
 */
export function findAssignmentWrappersOnLine(
	line: string
): InlineAssignmentWrapper[] {
	const out: InlineAssignmentWrapper[] = [];
	const lower = line.toLowerCase();
	let i = 0;

	while (i < line.length) {
		const open = lower.indexOf("<span", i);
		if (open === -1) break;
		const end = findMatchingSpanEndIndexDeterministic(line, open);
		if (end === -1) break;

		const segment = line.slice(open, end);
		// Only accept members.assignee wrappers
		if (/\bdata-template-key\s*=\s*"members\.assignee"/i.test(segment)) {
			const instanceId = getAttr(segment, "data-template-wrapper");
			const assignTypeStr = getAttr(segment, "data-assign-type");
			const assignType =
				assignTypeStr === "assignee" || assignTypeStr === "delegate"
					? (assignTypeStr as "assignee" | "delegate")
					: null;
			out.push({ start: open, end, instanceId, assignType, segment });
		}

		i = end;
	}

	return out;
}

/**
 * Remove all wrappers of the given assignType on this line.
 * If exceptInstanceId is provided, keep that one wrapper.
 */
export function removeWrappersOfTypeOnLine(
	line: string,
	assignType: "assignee" | "delegate",
	exceptInstanceId: string | null
): string {
	const wrappers = findAssignmentWrappersOnLine(line);
	if (wrappers.length === 0) return line;

	const toRemove = wrappers.filter(
		(w) => w.assignType === assignType && w.instanceId !== exceptInstanceId
	);
	if (toRemove.length === 0) return line;

	// Remove segments from right to left to preserve indices
	toRemove.sort((a, b) => b.start - a.start);
	let next = line;
	for (const w of toRemove) {
		next = next.slice(0, w.start) + next.slice(w.end);
	}

	// Clean up spacing but preserve task/list prefix indentation
	const taskPrefixRe = /^(\s*[-*+]\s+\[(?: |x|X)\]\s+)/;
	const m = next.match(taskPrefixRe);
	if (m) {
		const prefix = m[1];
		const rest = next.slice(prefix.length).replace(/ {2,}/g, " ");
		next = prefix + rest;
	} else {
		next = next.replace(/ {2,}/g, " ");
	}
	// Ensure single trailing space at end of line (helps caret placement)
	next = next.replace(/\s+$/, " ");
	return next;
}

/**
 * Replace a specific wrapper instance (by data-template-wrapper) with newHtml.
 * Returns the updated line. If not found, returns original line.
 */
export function replaceWrapperInstanceOnLine(
	line: string,
	instanceId: string,
	newHtml: string
): string {
	const wrappers = findAssignmentWrappersOnLine(line);
	const target = wrappers.find((w) => w.instanceId === instanceId);
	if (!target) return line;
	return line.slice(0, target.start) + newHtml + line.slice(target.end);
}
