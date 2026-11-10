/**
 * Canonical normalization rules for task lines.
 * Reorders extracted pieces into standardized structure, with whitespace polish and HTML safety.
 */

import type {
	NormalizeOptions,
	CanonicalPieces,
	TagInstance,
} from "./canonical-types";
import { extractAll } from "./canonical-extract";
import {
	normalizeWhitespaceOutsideWrappers,
	ensureSafeTrailingSpaceForHtml,
} from "./canonical-utils";
import {
	findAllWrappers,
	hasBalancedWrappers,
} from "./html/canonical-html-scanner";

export { type NormalizeOptions };

/** members.assignee chip kinds (old Agile Obsidian plugin). Only used to write `assignee → delegate`. */
function assignKind(tag: TagInstance): "assignee" | "delegate" | null {
	if (
		tag.templateKey !== "members.assignee" &&
		tag.props["template-key"] !== "members.assignee"
	) {
		return null;
	}
	const assignType = tag.props["assign-type"] || tag.props["assigntype"];
	if (assignType === "assignee" || assignType === "special") return "assignee";
	if (assignType === "delegate") return "delegate";
	return null;
}

/**
 * Other tags sorted alphabetically by order-tag (missing order-tag last; stable, so
 * chips with the same tag keep their original relative order). Chips are only ever
 * moved: an assignee directly followed by a delegate is written `assignee → delegate`,
 * every other assignee/delegate chip stays where the sort puts it.
 */
function orderOtherTags(tags: TagInstance[]): string[] {
	const sorted = [...tags].sort((a, b) => {
		const oa = (a.orderTag ?? "").toLowerCase();
		const ob = (b.orderTag ?? "").toLowerCase();
		if (oa && !ob) return -1;
		if (!oa && ob) return 1;
		return oa.localeCompare(ob);
	});

	const out: string[] = [];
	for (let i = 0; i < sorted.length; i++) {
		const cur = sorted[i];
		const next = sorted[i + 1];
		if (
			next &&
			assignKind(cur) === "assignee" &&
			assignKind(next) === "delegate"
		) {
			out.push(`${cur.wrapperHtml} → ${next.wrapperHtml}`);
			i++;
		} else {
			out.push(cur.wrapperHtml);
		}
	}
	return out;
}

/** Wrapper HTML strings of a line, sorted, for "same chips in, same chips out" checks. */
function wrapperMultiset(html: string): string[] {
	return findAllWrappers(html).sort();
}

function sameWrappers(a: string, b: string): boolean {
	if (!hasBalancedWrappers(a) || !hasBalancedWrappers(b)) return false;
	const wa = wrapperMultiset(a);
	const wb = wrapperMultiset(b);
	return wa.length === wb.length && wa.every((w, i) => w === wb[i]);
}

export function normalizeTaskLine(
	line: string,
	_opts: NormalizeOptions = {}
): string {
	try {
		const extracted = extractAll(line);
		if (!extracted) return line;

		// Canonical order:
		// [status] {parent-links} {artifact-item-types} {task text} {state} {other tags (alphabetically by order-tag; assignee → delegate joined)} {metadata} {ordered date tokens} {block ID}
		// Every chip on the line is kept: extra parent-link / artifact-item-type chips
		// follow the first of their tag, in their original order.

		const stateHtml =
			extracted.states.length > 0
				? extracted.states.map((s) => s.wrapperHtml).join(" ")
				: undefined;

		const pieces: CanonicalPieces = {
			prefix: extracted.prefix,
			parentLinks: extracted.parentLinks.map((t) => t.wrapperHtml),
			artifactItemTypes: extracted.artifactItemTypes.map(
				(t) => t.wrapperHtml
			),
			taskText: extracted.taskText,
			state: stateHtml,
			otherTags: orderOtherTags(extracted.otherTags),
			metadata: extracted.metadata.map((m) => m.wrapperHtml),
			dateTokens: extracted.dateTokens,
			blockId: extracted.blockId ?? undefined,
		};

		let out = pieces.prefix;

		const push = (frag?: string) => {
			if (!frag) return;
			out += (out.endsWith(" ") ? "" : " ") + frag;
		};

		if (pieces.parentLinks.length) push(pieces.parentLinks.join(" "));
		if (pieces.artifactItemTypes.length)
			push(pieces.artifactItemTypes.join(" "));
		if (pieces.taskText) push(pieces.taskText);
		push(pieces.state);
		if (pieces.otherTags.length) push(pieces.otherTags.join(" "));
		if (pieces.metadata.length) push(pieces.metadata.join(" "));
		if (pieces.dateTokens.length) push(pieces.dateTokens.join(" "));
		if (pieces.blockId) push(pieces.blockId);

		// Final polish: collapse whitespace runs between chips (never inside one), keep
		// trailing whitespace if present, and ensure a trailing space if we end on a
		// closing HTML tag.
		out = normalizeWhitespaceOutsideWrappers(out);
		out = ensureSafeTrailingSpaceForHtml(out);

		// Safety net: the formatter only reorders. If the output does not carry exactly
		// the chips the input had (e.g. a block id or date token that sat inside a chip
		// was pulled out of it), leave the line alone rather than lose or alter a chip.
		if (!sameWrappers(line, out)) return line;

		return out;
	} catch {
		return line;
	}
}
