import { TaskItem } from "@features/tasks";
import { getTemplateKeysFromTask } from "@features/templating";
import type { AgileArtifactType } from "./types";

/**
 * Fallback: extract template keys directly from HTML wrappers if present.
 * Looks for data-template-key="...".
 */
function extractTemplateKeysFromText(
	text: string | undefined | null
): string[] {
	if (!text || typeof text !== "string") return [];
	const re = /data-template-key\s*=\s*["']([^"']+)["']/gi;
	const keys: string[] = [];
	for (const m of text.matchAll(re)) {
		if (m[1]) keys.push(m[1]);
	}
	return keys;
}

/**
 * Normalize a template key to a canonical AgileArtifactType by pattern matching.
 * This is resilient to different naming styles (kebab/camel/dotted, v2 suffixes, etc.).
 */
function inferTypeFromKey(key: string): AgileArtifactType | undefined {
	const k = (key || "").toLowerCase();

	// Learning Initiative
	if (k.includes("learning") && k.includes("initiative")) {
		return "learning-initiative";
	}
	// Initiative
	if (k.includes("initiative")) {
		return "initiative";
	}

	// Learning Epic
	if (k.includes("learning") && k.includes("epic")) {
		return "learning-epic";
	}
	// Epic
	if (k.includes("epic")) {
		return "epic";
	}

	// Story / User Story
	if (
		k.includes("userstory") ||
		k.includes("user-story") ||
		k.includes("user.story")
	) {
		return "story";
	}
	if (k.endsWith(".story") || k.includes(".story") || k.includes("story")) {
		return "story";
	}

	// OKR
	if (k.includes("okr")) {
		return "okr";
	}

	// Recurring Responsibility
	if (
		k.includes("recurring-responsibility") ||
		k.includes("responsibility.recurring") ||
		(k.includes("responsibility") && k.includes("recurring")) ||
		k.includes("responsibilityrecurring")
	) {
		return "recurring-responsibility";
	}

	return undefined;
}

/**
 * Resolve the first matching canonical type from present template keys, if any.
 * If no recognized template is present:
 * - returns "task" for non-open/done/archived items (legacy rule)
 * - returns null for open/done/archived items (preserve prior behavior)
 */
export const getAgileArtifactType = (
	task: TaskItem
): AgileArtifactType | null => {
	// Prefer templating helper
	let keys = (getTemplateKeysFromTask(task) as string[]) ?? [];

	// Fallback to scanning inline wrappers if helper returns nothing
	if (
		!keys.length &&
		typeof task.text === "string" &&
		task.text.includes("data-template-key")
	) {
		keys = extractTemplateKeysFromText(task.text);
	}

	// Apply resilient inference for refactored keys
	for (const k of keys) {
		const inferred = inferTypeFromKey(k);
		if (inferred) return inferred;
	}

	// No template detected -> preserve original rule
	if (task.status !== "O" && task.status !== "d" && task.status !== "A") {
		return "task";
	} else {
		return null;
	}
};
