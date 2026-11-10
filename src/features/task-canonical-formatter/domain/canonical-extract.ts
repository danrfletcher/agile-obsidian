/**
 * Parses a task line, extracts wrappers, date tokens, block id, and the "plain" task text.
 * Classifies wrapper instances by orderTag and template metadata.
 */

import {
	extractPrefix,
	extractBlockId,
	normalizeWhitespacePreserveTrailing,
	getAttr,
	collectDataProps,
	extractInnerHtml,
} from "./canonical-utils";
import {
	extractAndOrderDateTokens,
	removeDateTokensFromText,
} from "./canonical-date-tokens";
import type { Extracted, ParsedLine, TagInstance } from "./canonical-types";
import {
	findAllWrappers,
	hasBalancedWrappers,
	removeWrappersByTemplate,
} from "./html/canonical-html-scanner";

export function parseLine(line: string): ParsedLine | null {
	const { prefix, rest } = extractPrefix(line);
	if (!prefix) return null;
	const { restSansBlockId, blockId } = extractBlockId(rest);
	return { prefix, restOriginal: rest, restSansBlockId, blockId };
}

function parseTag(wrapperHtml: string): TagInstance {
	const templateKey = getAttr(wrapperHtml, "data-template-key") ?? "";
	const orderTag = getAttr(wrapperHtml, "data-order-tag");
	const props = collectDataProps(wrapperHtml);
	const markInnerHtml = extractInnerHtml(wrapperHtml);
	return { wrapperHtml, templateKey, orderTag, props, markInnerHtml };
}

/**
 * Splits wrappers by order tag. Every wrapper lands in exactly one bucket, in its
 * original relative order: nothing is dropped, whatever the tag (including unknown
 * tags and the old `assignment` / members.assignee chips).
 */
function classifyTags(wrappers: string[]) {
	const parentLinks: TagInstance[] = [];
	const artifactItemTypes: TagInstance[] = [];
	const state: TagInstance[] = [];
	const metadata: TagInstance[] = [];
	const other: TagInstance[] = [];

	for (const w of wrappers) {
		const tag = parseTag(w);
		const ot = (tag.orderTag ?? tag.props["order-tag"]) || undefined;

		if (ot === "parent-link") parentLinks.push(tag);
		else if (ot === "artifact-item-type") artifactItemTypes.push(tag);
		else if (ot === "state") state.push(tag);
		else if (ot === "metadata") metadata.push(tag);
		else other.push(tag);
	}

	return { parentLinks, artifactItemTypes, state, other, metadata };
}

/**
 * Returns null when the line is not a task line, or when a chip wrapper on it is not
 * closed (the scanner would take "the rest of the line" as the chip). In both cases the
 * caller must leave the line exactly as it is.
 */
export function extractAll(line: string): Extracted | null {
	const parsed = parseLine(line);
	if (!parsed) return null;
	if (!hasBalancedWrappers(parsed.restSansBlockId)) return null;

	// Gather wrappers using a balanced scanner (handles nested spans safely)
	const wrappers = findAllWrappers(parsed.restSansBlockId);

	// Extract date tokens
	const dateTokens = extractAndOrderDateTokens(parsed.restSansBlockId);
	let textSansDates = removeDateTokensFromText(parsed.restSansBlockId);

	// Remove wrappers from text to get the task "plain text"
	// Use the same balanced scanner to ensure we remove full wrappers without leaving stray closers.
	const { withoutWrappers } = removeWrappersByTemplate(textSansDates);

	// We remove wrappers entirely and collapse whitespace (internally); also remove "→"
	let taskText = withoutWrappers.replace(/→/g, " ");
	taskText = normalizeWhitespacePreserveTrailing(taskText);

	const classes = classifyTags(wrappers);

	return {
		parentLinks: classes.parentLinks,
		artifactItemTypes: classes.artifactItemTypes,
		states: classes.state,
		metadata: classes.metadata,
		otherTags: classes.other,
		dateTokens,
		taskText,
		blockId: parsed.blockId,
		prefix: parsed.prefix,
	};
}
