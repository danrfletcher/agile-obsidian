/**
 * Shared types for canonical task formatting.
 */

export type NormalizeOptions = {
	/**
	 * Abort a long-running whole-file normalization. The service will periodically check
	 * and stop early if signal.aborted is true. Safe to pass for line-level ops.
	 */
	abortSignal?: AbortSignal;
};

export type ParsedLine = {
	/** "- [ ] " including any marker characters/spaces */
	prefix: string;
	/** Original remainder after prefix */
	restOriginal: string;
	/** Remainder with block id removed (all deduped/standalone ^ids sanitized) */
	restSansBlockId: string;
	/** Canonical block id "^id" chosen from last standalone occurrence, or null */
	blockId: string | null;
};

export type TagInstance = {
	/** full <span data-template-key="...">...</span> */
	wrapperHtml: string;
	/** e.g., "agile.epic", "members.assignee", etc. */
	templateKey: string;
	/** from wrapper's data-order-tag if present */
	orderTag?: string;
	/** data-* props extracted from wrapper */
	props: Record<string, string>;
	/** content inside wrapper (may include <mark>) */
	markInnerHtml: string;
};

export type Extracted = {
	/** orderTag==="parent-link", every chip, in original order */
	parentLinks: TagInstance[];
	/** orderTag==="artifact-item-type", every chip, in original order */
	artifactItemTypes: TagInstance[];
	/** orderTag==="state" (multiple possible) */
	states: TagInstance[];
	/** orderTag==="metadata" */
	metadata: TagInstance[];
	/**
	 * Anything else, in original order: unknown/missing order tags, `crm-*`, `priority`
	 * and the old `assignment` (members.assignee) chips. Nothing is dropped.
	 */
	otherTags: TagInstance[];
	/** extracted plain-text tokens like "📅 2025-01-01" */
	dateTokens: string[];
	/** text content after removing wrappers, date tokens, arrows, normalizing ws (trailing preserved) */
	taskText: string;
	blockId: string | null;
	prefix: string;
};

export type CanonicalPieces = {
	prefix: string;
	/** every parent-link chip, original order */
	parentLinks: string[];
	/** every artifact-item-type chip, original order */
	artifactItemTypes: string[];
	taskText: string;
	state?: string;
	/** sorted alphabetically by order-tag (stable), an assignee directly followed by a delegate joined with "→" */
	otherTags: string[];
	metadata: string[];
	dateTokens: string[];
	blockId?: string;
};
