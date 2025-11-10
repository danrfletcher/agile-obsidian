import { CloseIntent, LineClassifierPort, TokenOpsPort } from "./ports";

/**
 * Extracts parent close intent and optional yyyy-mm-dd date from a line.
 */
export function extractParentCloseIntent(
	line: string,
	classifier: LineClassifierPort,
	tokens: TokenOpsPort
): { intent: CloseIntent | null; date: string | null } {
	const status = (classifier.getCheckboxStatusChar(line) ?? "").toLowerCase();
	if (status !== "x" && status !== "-") return { intent: null, date: null };
	const emoji =
		status === "x" ? tokens.COMPLETED_EMOJI : tokens.CANCELLED_EMOJI;
	const re = new RegExp(
		`${escapeRegExp(emoji)}\\s*(${tokens.ISO_DATE_RE.source})?`,
		"i"
	);
	const m = re.exec(line);
	const date = (m?.[1] ?? null) as string | null;
	return { intent: status === "x" ? "complete" : "cancel", date };
}

/**
 * Find descendant line indices by indentation under a parent list item.
 */
export function collectDescendantIndices(
	lines: string[],
	parentLine0: number,
	classifier: LineClassifierPort
): number[] {
	const out: number[] = [];
	if (parentLine0 < 0 || parentLine0 >= lines.length) return out;
	const parent = lines[parentLine0];
	if (!classifier.isListLine(parent)) return out;
	const parentIndent = classifier.indentWidth(parent);
	for (let i = parentLine0 + 1; i < lines.length; i++) {
		const s = lines[i] ?? "";
		if (!classifier.isListLine(s)) {
			const trimmed = s.trim();
			const iw = classifier.indentWidth(s);
			if (trimmed.length > 0 && iw <= parentIndent) break;
			continue;
		}
		const iw = classifier.indentWidth(s);
		if (iw <= parentIndent) break;
		out.push(i);
	}
	return out;
}

/**
 * Returns true if a line is a task and not already closed.
 */
export function isTaskLineIncomplete(
	text: string,
	classifier: LineClassifierPort,
	tokens: TokenOpsPort
): boolean {
	if (!classifier.isTaskLine(text)) return false;
	const status = (classifier.getCheckboxStatusChar(text) ?? "").toLowerCase();
	if (status === "x" || status === "-") return false;
	if (tokens.hasEmoji(text, tokens.COMPLETED_EMOJI)) return false;
	if (tokens.hasEmoji(text, tokens.CANCELLED_EMOJI)) return false;
	return true;
}

/**
 * Compute the new text for a descendant task line given parent intent/date.
 */
export function rewriteDescendantLine(
	orig: string,
	intent: CloseIntent,
	date: string | null,
	classifier: LineClassifierPort,
	tokens: TokenOpsPort
): string {
	const targetStatusChar = intent === "complete" ? "x" : "-";
	const targetEmoji =
		intent === "complete" ? tokens.COMPLETED_EMOJI : tokens.CANCELLED_EMOJI;
	const otherEmoji =
		intent === "complete" ? tokens.CANCELLED_EMOJI : tokens.COMPLETED_EMOJI;

	// Update checkbox
	let updated = classifier.setCheckboxStatusChar(orig, targetStatusChar);

	// Normalize emojis to a single target emoji with optional date
	if (tokens.hasEmoji(updated, otherEmoji))
		updated = tokens.removeEmoji(updated, otherEmoji);
	if (tokens.hasEmoji(updated, targetEmoji))
		updated = tokens.removeEmoji(updated, targetEmoji);
	updated = tokens.appendEmojiWithDate(
		updated,
		targetEmoji,
		date ?? undefined
	);

	// Normalize trailing whitespace
	updated = updated.replace(/\s+$/, " ");
	return updated;
}

/**
 * Calculate the set of edits to apply for a cascade, given the parent line index.
 * Returns a map of lineIndex -> newText.
 */
export function computeCascadeEdits(
	lines: string[],
	parentLine0: number,
	classifier: LineClassifierPort,
	tokens: TokenOpsPort
): Map<number, string> {
	const edits = new Map<number, string>();
	const { intent, date } = extractParentCloseIntent(
		lines[parentLine0] ?? "",
		classifier,
		tokens
	);
	if (!intent) return edits;

	const descendants = collectDescendantIndices(
		lines,
		parentLine0,
		classifier
	);
	for (const line0 of descendants) {
		if (line0 === parentLine0) continue;
		const orig = lines[line0] ?? "";
		if (!isTaskLineIncomplete(orig, classifier, tokens)) continue;
		const rewritten = rewriteDescendantLine(
			orig,
			intent,
			date,
			classifier,
			tokens
		);
		if (rewritten !== orig) edits.set(line0, rewritten);
	}
	return edits;
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
