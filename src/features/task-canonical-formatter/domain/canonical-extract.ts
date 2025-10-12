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
	removeWrappersByTemplate,
} from "./html/canonical-html-scanner";

// Assignee/delegate detection relies on Members.assignee template with props:
//  - data-assign-type="assignee" | "delegate"
//  - data-member-type, data-assignment-state, etc.

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

function classifyTags(wrappers: string[]) {
	const parentLink: TagInstance[] = [];
	const artifactItemType: TagInstance[] = [];
	const state: TagInstance[] = [];
	const metadata: TagInstance[] = [];
	const other: TagInstance[] = [];

	const assignments: { assignee?: TagInstance; delegate?: TagInstance } = {};

	for (const w of wrappers) {
		const tag = parseTag(w);
		const ot = (tag.orderTag ?? tag.props["order-tag"]) || undefined;

		// Detect assignments based on template and assignType
		if (
			tag.templateKey === "members.assignee" ||
			tag.props["template-key"] === "members.assignee"
		) {
			const assignType =
				tag.props["assign-type"] || tag.props["assigntype"];
			if (assignType === "assignee" || assignType === "special") {
				if (!assignments.assignee) assignments.assignee = tag;
				continue;
			}
			if (assignType === "delegate") {
				if (!assignments.delegate) assignments.delegate = tag;
				continue;
			}
		}

		// Split based on order tag
		if (ot === "parent-link") {
			if (parentLink.length === 0) parentLink.push(tag);
			continue;
		}
		if (ot === "artifact-item-type") {
			if (artifactItemType.length === 0) artifactItemType.push(tag);
			continue;
		}
		if (ot === "state") {
			state.push(tag);
			continue;
		}
		if (ot === "metadata") {
			metadata.push(tag);
			continue;
		}

		other.push(tag);
	}

	return {
		parentLink: parentLink[0],
		artifactItemType: artifactItemType[0],
		state: state,
		other,
		metadata,
		assignments,
	};
}

export function extractAll(line: string): Extracted | null {
	const parsed = parseLine(line);
	if (!parsed) return null;

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
		parentLink: classes.parentLink,
		artifactItemType: classes.artifactItemType,
		states: classes.state,
		assignments: classes.assignments,
		metadata: classes.metadata,
		otherTags: classes.other,
		dateTokens,
		taskText,
		blockId: parsed.blockId,
		prefix: parsed.prefix,
	};
}
