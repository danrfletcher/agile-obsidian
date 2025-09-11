import type { NormalizeOptions, CanonicalPieces } from "./canonical-types";
import { extractAll } from "./canonical-extract";
import {
	normalizeWhitespacePreserveTrailing,
	ensureSafeTrailingSpaceForHtml,
} from "./canonical-utils";

export { type NormalizeOptions };

export function normalizeTaskLine(
	line: string,
	opts: NormalizeOptions = {}
): string {
	try {
		const extracted = extractAll(line);
		if (!extracted) return line;

		// Build canonical pieces per new ordering:
		// [status] {parent-link} {artifact-item-type} {task text} {state} {any other tags (alphabetically by order-tag)} {assignee → delegate} {metadata} {ordered date tokens} {block ID}

		// Apply overrides for assignments, if provided
		let assigneeHtml = extracted.assignments.assignee?.wrapperHtml ?? null;
		let delegateHtml = extracted.assignments.delegate?.wrapperHtml ?? null;

		const hasOverrideAssignee = Object.prototype.hasOwnProperty.call(
			opts,
			"newAssigneeInstanceHtml"
		);
		const hasOverrideDelegate = Object.prototype.hasOwnProperty.call(
			opts,
			"newDelegateInstanceHtml"
		);

		if (hasOverrideAssignee)
			assigneeHtml = opts.newAssigneeInstanceHtml ?? null;
		if (hasOverrideDelegate)
			delegateHtml = opts.newDelegateInstanceHtml ?? null;

		// If no assignee, remove delegate
		if (!assigneeHtml) {
			delegateHtml = null;
		}

		// Compose states (multiple possible)
		const stateHtml =
			extracted.states.length > 0
				? extracted.states.map((s) => s.wrapperHtml).join(" ")
				: undefined;

		// Other tags sorted alphabetically by order-tag (missing orderTag last)
		const otherSorted = [...extracted.otherTags].sort((a, b) => {
			const oa = (a.orderTag ?? "").toLowerCase();
			const ob = (b.orderTag ?? "").toLowerCase();
			if (oa && !ob) return -1;
			if (!oa && ob) return 1;
			return oa.localeCompare(ob);
		});

		const pieces: CanonicalPieces = {
			prefix: extracted.prefix,
			parentLink: extracted.parentLink?.wrapperHtml,
			artifactItemType: extracted.artifactItemType?.wrapperHtml,
			taskText: extracted.taskText,
			state: stateHtml,
			otherTags: otherSorted.map((t) => t.wrapperHtml),
			assignee: assigneeHtml ?? undefined,
			delegate: delegateHtml ?? undefined,
			metadata: extracted.metadata.map((m) => m.wrapperHtml),
			dateTokens: extracted.dateTokens,
			blockId: extracted.blockId ?? undefined,
		};

		let out = pieces.prefix;

		const push = (frag?: string) => {
			if (!frag) return;
			out += (out.endsWith(" ") ? "" : " ") + frag;
		};

		push(pieces.parentLink);
		push(pieces.artifactItemType);
		if (pieces.taskText) push(pieces.taskText);
		push(pieces.state);
		if (pieces.otherTags.length) push(pieces.otherTags.join(" "));
		if (pieces.assignee && pieces.delegate) {
			// Both present: "assignee → delegate"
			push(`${pieces.assignee} → ${pieces.delegate}`);
		} else if (pieces.assignee) {
			push(pieces.assignee);
		} else if (pieces.delegate) {
			// per rule: delegate without assignee is invalid → drop delegate
		}

		if (pieces.metadata.length) push(pieces.metadata.join(" "));
		if (pieces.dateTokens.length) push(pieces.dateTokens.join(" "));
		if (pieces.blockId) push(pieces.blockId);

		// Final polish: collapse internal whitespace but keep trailing if present,
		// and ensure a trailing space if we end on a closing HTML tag.
		out = normalizeWhitespacePreserveTrailing(out);
		out = ensureSafeTrailingSpaceForHtml(out);

		return out;
	} catch {
		return line;
	}
}
