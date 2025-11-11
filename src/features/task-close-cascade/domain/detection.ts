import {
	ClosedTransition,
	LineClassifierPort,
	TokenOpsPort,
} from "./ports";
import { collectDescendantIndices, isTaskLineIncomplete } from "./cascade";

/**
 * True if cascade would affect at least one descendant incomplete task.
 */
export function wouldCascade(
	lines: string[],
	parentLine0: number,
	classifier: LineClassifierPort,
	tokens: TokenOpsPort
): boolean {
	const descendants = collectDescendantIndices(
		lines,
		parentLine0,
		classifier
	);
	if (!descendants.length) return false;
	for (const i of descendants) {
		if (isTaskLineIncomplete(lines[i] ?? "", classifier, tokens))
			return true;
	}
	return false;
}

/**
 * Detect "closed" transitions between snapshots, up to a bounded number of inspected lines.
 */
export function detectClosedTransitions(
	prevLines: string[],
	nextLines: string[],
	classifier: LineClassifierPort,
	tokens: TokenOpsPort,
	maxInspect = 200
): ClosedTransition[] {
	const maxLen = Math.max(prevLines.length, nextLines.length);
	const changes: ClosedTransition[] = [];
	let inspected = 0;

	for (let i = 0; i < maxLen; i++) {
		const before = prevLines[i] ?? "";
		const after = nextLines[i] ?? "";
		if (before === after) continue;

		const wasTask = classifier.isTaskLine(before);
		const isTask = classifier.isTaskLine(after);
		if (!wasTask || !isTask) {
			if (++inspected > maxInspect) break;
			continue;
		}

		const statusBefore = (
			classifier.getCheckboxStatusChar(before) ?? ""
		).toLowerCase();
		const statusAfter = (
			classifier.getCheckboxStatusChar(after) ?? ""
		).toLowerCase();

		const wasClosed =
			statusBefore === "x" ||
			statusBefore === "-" ||
			tokens.hasEmoji(before, tokens.COMPLETED_EMOJI) ||
			tokens.hasEmoji(before, tokens.CANCELLED_EMOJI);

		const nowCompleted =
			statusAfter === "x" ||
			tokens.hasEmoji(after, tokens.COMPLETED_EMOJI);
		const nowCancelled =
			statusAfter === "-" ||
			tokens.hasEmoji(after, tokens.CANCELLED_EMOJI);

		if (!wasClosed && (nowCompleted || nowCancelled)) {
			changes.push({
				line0: i,
				intent: nowCompleted
					? ("complete" as const)
					: ("cancel" as const),
			});
		}

		if (++inspected > maxInspect) break;
	}
	return changes;
}
