export type NormalizeOptions = {
	newAssigneeInstanceHtml?: string | null;
	newDelegateInstanceHtml?: string | null;
};

export type ParsedLine = {
	prefix: string; // "- [ ] " including any marker characters/spaces
	restOriginal: string; // original remainder after prefix
	restSansBlockId: string; // remainder with block id removed
	blockId: string | null; // ^block-id
};

export type TagInstance = {
	wrapperHtml: string; // full <span data-template-wrapper="...">...</span>
	templateKey: string; // e.g., "agile.epic", "members.assignee", etc.
	orderTag?: string; // from wrapper's data-order-tag if present
	props: Record<string, string>; // data-* props extracted from wrapper
	markInnerHtml: string; // content inside wrapper (may include <mark>)
};

export type Extracted = {
	parentLink?: TagInstance; // orderTag==="parent-link"
	artifactItemType?: TagInstance; // orderTag==="artifact-item-type"
	states: TagInstance[]; // orderTag==="state"
	assignments: {
		assignee?: TagInstance; // members.assignee with assignType="assignee" or "special"
		delegate?: TagInstance; // members.assignee with assignType="delegate"
	};
	metadata: TagInstance[]; // orderTag==="metadata"
	otherTags: TagInstance[]; // anything else (obsidian, workflows metadata already in metadata)
	dateTokens: string[]; // extracted plain-text tokens like "📅 2025-01-01"
	taskText: string; // text content after removing wrappers, date tokens, arrows, normalizing ws (trailing preserved)
	blockId: string | null;
	prefix: string;
};

export type CanonicalPieces = {
	prefix: string;
	parentLink?: string;
	artifactItemType?: string;
	taskText: string;
	state?: string;
	otherTags: string[]; // sorted alphabetically by order-tag
	assignee?: string;
	delegate?: string;
	metadata: string[];
	dateTokens: string[];
	blockId?: string;
};
