/**
 * Caret mapping heuristic to keep the caret close to what the user just typed
 * after reordering/normalizing a line.
 * Strategy:
 * 1) Build a map from stable tokens in old line to positions in new line.
 * 2) If mapping fails, use anchor-based search around the old caret.
 * 3) Fallback: snap to end of new line.
 */

// Precompiled sanitation regexes (hot path)
const WRAPPER_RE =
	/<span\b[^>]*\bdata-template-key="[^"]+"[^>]*>[\s\S]*?<\/span>/gi;
const DATE_RE = /(🛫|⏳|📅|🎯|✅|❌)\s+\d{4}-\d{2}-\d{2}/g;
const SNOOZE_RE =
	/💤(?:⬇️)?(?:<span style="display: none">[^<]+<\/span>)?(?:\s+\d{4}-\d{2}-\d{2})?/g;
const BLOCKID_RE = /(^|\s)\^[A-Za-z0-9-]+(?![A-Za-z0-9-])/g;

export function computeNewCaretAfterNormalize(
	oldLine: string,
	newLine: string,
	oldSel: { start: number; end: number }
): { start: number; end: number } {
	// Fast path: if lines are identical, keep selection
	if (oldLine === newLine) return { start: oldSel.start, end: oldSel.end };

	// Try to keep caret relative to user-visible task text by tracking token moves.
	const tokens = extractStableTokens(oldLine);
	const mapping = buildStableMap(tokens, newLine);
	const target = mapPositionUsingTokens(oldLine, newLine, oldSel, mapping);
	if (target) return target;

	// Defensive defaults: if selection is bad/missing, snap to end of new line.
	if (
		!oldSel ||
		typeof oldSel.start !== "number" ||
		typeof oldSel.end !== "number"
	) {
		const caret = newLine.length; // end of line
		return { start: caret, end: caret };
	}

	const isRange = oldSel.start !== oldSel.end;
	const caret = oldSel.end;

	// Heuristic anchors around caret
	const anchorLen = 16;
	const leftAnchorStart = Math.max(0, caret - anchorLen);
	const leftAnchor = oldLine.slice(leftAnchorStart, caret);

	const rightAnchorEnd = Math.min(oldLine.length, caret + anchorLen);
	const rightAnchor = oldLine.slice(caret, rightAnchorEnd);

	// Prefer left anchor match to keep caret after typed text
	let pos = locateAfterAnchor(newLine, leftAnchor);
	if (pos == null) {
		// Try sandwich anchor (left + right)
		pos = locateBetweenAnchors(newLine, leftAnchor, rightAnchor);
	}
	if (pos == null) {
		// Try right anchor (place caret before it)
		pos = locateBeforeRightAnchor(newLine, rightAnchor);
	}
	if (pos == null) {
		// FINAL FALLBACK: snap to end of new line (after any ensured trailing space)
		const endPos = newLine.length;
		return { start: endPos, end: endPos };
	}

	if (isRange) {
		// Preserve selection width if possible
		const width = oldSel.end - oldSel.start;
		const start = Math.max(0, Math.min(pos - width, newLine.length));
		const end = Math.max(0, Math.min(pos, newLine.length));
		if (start <= end) return { start, end };
		return { start: end, end: start };
	} else {
		const clamped = Math.max(0, Math.min(pos, newLine.length));
		return { start: clamped, end: clamped };
	}
}

// Heuristic tokenization that prefers stable user text over wrappers/tags
function extractStableTokens(
	s: string
): Array<{ text: string; start: number; end: number }> {
	const tokens: Array<{ text: string; start: number; end: number }> = [];
	// Remove obvious wrappers, date tokens, block ids to focus on task text and arrows
	const sanitized = s
		.replace(WRAPPER_RE, (_m) => " ")
		.replace(DATE_RE, " ")
		.replace(SNOOZE_RE, " ")
		.replace(BLOCKID_RE, " ")
		.replace(/→/g, " ");
	// Split into words while tracking indices in original string
	let i = 0;
	while (i < sanitized.length) {
		while (i < sanitized.length && /\s/.test(sanitized[i])) i++;
		const start = i;
		while (i < sanitized.length && /\S/.test(sanitized[i])) i++;
		const end = i;
		if (end > start) {
			const text = sanitized.slice(start, end);
			if (text.length >= 2) tokens.push({ text, start, end });
		}
	}
	return tokens;
}

function buildStableMap(
	tokens: Array<{ text: string; start: number; end: number }>,
	newLine: string
): Map<number, number> {
	const map = new Map<number, number>();
	for (const t of tokens) {
		const idx = newLine.indexOf(t.text);
		if (idx !== -1) {
			// map end-of-token position to new end position
			map.set(t.end, idx + t.text.length);
		}
	}
	return map;
}

function mapPositionUsingTokens(
	_oldLine: string,
	newLine: string,
	oldSel: { start: number; end: number },
	mapping: Map<number, number>
): { start: number; end: number } | null {
	// Find the closest mapped token end at or before caret end
	const caret = oldSel.end;
	let bestOld = -1;
	for (const oldEnd of mapping.keys()) {
		if (oldEnd <= caret && oldEnd > bestOld) bestOld = oldEnd;
	}
	if (bestOld !== -1) {
		const mapped = mapping.get(bestOld)!;
		const width = Math.max(0, oldSel.end - oldSel.start);
		const start = Math.max(0, Math.min(mapped - width, newLine.length));
		const end = Math.max(0, Math.min(mapped, newLine.length));
		return { start, end };
	}
	return null;
}

function locateAfterAnchor(haystack: string, anchor: string): number | null {
	if (!anchor) return null;
	const idx = haystack.indexOf(anchor);
	if (idx === -1) return null;
	return idx + anchor.length;
}

function locateBetweenAnchors(
	haystack: string,
	left: string,
	right: string
): number | null {
	if (!left && !right) return null;
	const startIdx = left ? haystack.indexOf(left) : 0;
	if (startIdx === -1) return null;
	const afterLeft = startIdx + (left ? left.length : 0);
	if (!right) return afterLeft;
	const rightIdx = haystack.indexOf(right, afterLeft);
	if (rightIdx === -1) return null;
	// Target position is at the boundary between them, i.e. after left
	return afterLeft;
}

function locateBeforeRightAnchor(
	haystack: string,
	right: string
): number | null {
	if (!right) return null;
	const idx = haystack.indexOf(right);
	if (idx === -1) return null;
	return idx;
}
