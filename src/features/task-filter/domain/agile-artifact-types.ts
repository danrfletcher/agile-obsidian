import { TaskItem } from "@features/task-index";
import { getTemplateKeysFromTask } from "@features/templating-engine";
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
	if (!key) return undefined;

	// Lowercase and variants for robust matching
	const k = key.toLowerCase();
	// Flatten out separators to catch things like "agile.user_story" / "agile-userStory" / "agile.userstory"
	const flat = k.replace(/[._-\s]+/g, "");

	// Handle version suffixes like ".v2", "-v3", etc. (non-destructive for other patterns)
	const kNoVer = k.replace(/([._-])v(?:er(?:sion)?)?\d+\b/g, "");
	const flatNoVer = kNoVer.replace(/[._-\s]+/g, "");

	const has = (s: string) =>
		k.includes(s) ||
		flat.includes(s) ||
		kNoVer.includes(s) ||
		flatNoVer.includes(s);

	// Most specific first

	// Learning Initiative
	if (
		has("learninginitiative") ||
		(has("learning") && has("initiative")) ||
		has("personallearninginitiative")
	) {
		return "learning-initiative";
	}

	// Learning Epic
	if (
		has("learningepic") ||
		(has("learning") && has("epic")) ||
		has("personallearningepic")
	) {
		return "learning-epic";
	}

	// Initiative
	if (has("agile.initiative") || has("initiative")) {
		return "initiative";
	}

	// Epic
	if (has("agile.epic") || has("epic")) {
		return "epic";
	}

	// Story / User Story
	if (has("agile.userstory") || has("userstory") || has("user_story")) {
		return "story";
	}
	// Guarded fallback: "story" as a standalone token (avoid matching "history")
	if (/(^|[^a-z])story([^a-z]|$)/.test(k)) {
		return "story";
	}

	// OKR
	if (has("agile.okr") || has("okr")) {
		return "okr";
	}

	// Recurring Responsibility
	if (
		has("agile.recurringres") ||
		has("recurringres") ||
		has("recurring-responsibility") ||
		has("recurringresponsibility")
	) {
		return "recurring-responsibility";
	}

	return undefined;
}

/**
 * Heuristic fallback when templating is missing:
 * If a line has "🔁" plus an assignee wrapper, treat as a recurring responsibility.
 * Conservatively avoid colliding with initiatives/epics/stories.
 */
function heuristicRecurringResponsibility(
	text: string
): AgileArtifactType | undefined {
	if (typeof text !== "string" || text.length === 0) return undefined;
	const hasLoop = text.includes("🔁");
	// New-format assignee wrapper
	const hasAssigneeWrapper =
		/<span\b[^>]*data-template-key\s*=\s*["']members\.assignee["'][^>]*>/i.test(
			text
		);
	if (!hasLoop || !hasAssigneeWrapper) return undefined;

	// Avoid misclassifying common artifact words if present elsewhere
	const lc = text.toLowerCase();
	if (
		/\binitiative\b/.test(lc) ||
		/\bepic\b/.test(lc) ||
		/\buser\s*story\b|\bstory\b/.test(lc)
	) {
		return undefined;
	}
	return "recurring-responsibility";
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
	const txt = typeof task?.text === "string" ? task.text : "";

	try {
		// Prefer templating helper
		const keysFromHelper =
			(getTemplateKeysFromTask(task) as string[]) ?? [];

		// 1) Try helper-provided keys first
		for (const k of keysFromHelper) {
			const inferred = inferTypeFromKey(k);
			if (inferred) {
				return inferred;
			}
		}

		// 2) If no match yet, scan inline wrappers (helper may miss artifact key)
		if (txt && txt.includes("data-template-key")) {
			const scannedKeys = extractTemplateKeysFromText(txt);
			for (const k of scannedKeys) {
				const inferred = inferTypeFromKey(k);
				if (inferred) {
					return inferred;
				}
			}
		}

		// 2b) Heuristic fallback for recurring-responsibility (template missing)
		const heuristic = heuristicRecurringResponsibility(txt);
		if (heuristic) {
			return heuristic;
		}

		// 3) No template detected -> preserve original rule
		const status = (task as any)?.status;
		return status !== "O" && status !== "d" && status !== "A"
			? "task"
			: null;
	} catch {
		// Safe fallback
		const status = (task as any)?.status;
		return status !== "O" && status !== "d" && status !== "A"
			? "task"
			: null;
	}
};
