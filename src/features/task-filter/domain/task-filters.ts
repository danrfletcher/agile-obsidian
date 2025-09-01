import { TaskItem } from "@features/tasks";
import {
	Tokens,
	DateRe,
	parseYyyyMmDd,
	todayAtMidnight,
} from "./types";
import { escapeRegExp } from "@utils";

/**
 * Checks if a task is completed by detecting a ✅ YYYY-MM-DD marker in the text.
 *
 * Pattern: "✅ 2025-01-31" or "✅ 2025-01-31" (single space tolerated)
 */
export const isCompleted = (task: TaskItem): boolean => {
	const txt = task?.text ?? "";
	return new RegExp(
		`${escapeRegExp(Tokens.CompletedEmoji)}\\s${DateRe.source}`
	).test(txt);
};

/**
 * Checks if a task is cancelled by detecting a ❌ YYYY-MM-DD marker in the text.
 *
 * Pattern: "❌ 2025-01-31" or "❌2025-01-31" (optional space tolerated)
 */
export const isCancelled = (task: TaskItem): boolean => {
	const txt = task?.text ?? "";
	return new RegExp(
		`${escapeRegExp(Tokens.CancelledEmoji)}\\s?${DateRe.source}`
	).test(txt);
};

/**
 * A task is considered "in progress" if it is not completed, not cancelled, and not snoozed.
 * Snoozed tasks are not in progress.
 */
export const isInProgress = (
	task: TaskItem,
	taskMap: Map<string, TaskItem>
): boolean => {
	return (
		!isCompleted(task) && !isCancelled(task) && !isSnoozed(task, taskMap)
	);
};

type SnoozeMatch = {
	alias?: string | null;
	date?: string | null;
};

function collectSnoozeMatches(text: string, inherited: boolean): SnoozeMatch[] {
	// Direct snooze: 💤 [hidden-alias]? [date]?
	// Inherited snooze: 💤⬇️ [hidden-alias]? [date]?
	// Hidden alias is inside a span with style="display:none"
	const suffix = inherited
		? `${escapeRegExp(Tokens.SnoozeInheritedMarker)}`
		: `(?!${escapeRegExp(Tokens.SnoozeInheritedMarker)})`;
	const re = new RegExp(
		`${escapeRegExp(
			Tokens.SnoozeEmoji
		)}${suffix}\\s*(?:<span[^>]*style="\\s*display:\\s*none\\s*"[^>]*>([^<]*)<\\/span>)?\\s*(${
			DateRe.source
		})?`,
		"g"
	);
	const matches: SnoozeMatch[] = [];
	for (const m of text.matchAll(re)) {
		matches.push({
			alias: m[1] ?? null,
			date: m[2] ?? null,
		});
	}
	return matches;
}

/**
 * Returns true if the task is snoozed either directly or by inheritance from ancestors.
 * Snooze rules:
 * - Global snooze (no alias) applies to everyone until date (if provided). Without date, indefinite.
 * - Alias-specific snooze applies only to selectedAlias.
 * - Inheritance is indicated with 💤⬇️ on ancestors; direct snooze uses 💤 without ⬇️.
 * - A snooze with a valid future date snoozes until that date (exclusive). Past or invalid dates do not snooze.
 */
export const isSnoozed = (
	task: TaskItem,
	taskMap: Map<string, TaskItem>,
	selectedAlias?: string
): boolean => {
	if (!task || typeof task.text !== "string") {
		return false;
	}
	const today = todayAtMidnight();

	const applies = (
		matches: SnoozeMatch[],
		isGlobalCheck: boolean
	): boolean => {
		// Global snooze (no alias)
		const global = matches.find((m) => !m.alias);
		if (global && isGlobalCheck) {
			const until = parseYyyyMmDd(global.date);
			if (!global.date) return true;
			if (until && until > today) return true;
		}
		if (selectedAlias) {
			const aliasMatch = matches.find((m) => m.alias === selectedAlias);
			if (aliasMatch) {
				const until = parseYyyyMmDd(aliasMatch.date);
				if (!aliasMatch.date) return true;
				if (until && until > today) return true;
			}
		}
		return false;
	};

	// Direct snoozes
	const direct = collectSnoozeMatches(task.text, /* inherited */ false);
	if (direct.length && applies(direct, /* isGlobalCheck */ true)) {
		return true;
	}

	// Inherited snoozes by walking up parents
	let parentId = task._parentId;
	const seen = new Set<string>();
	while (parentId && !seen.has(parentId)) {
		seen.add(parentId);
		const parent = taskMap.get(parentId);
		if (!parent) break;
		const inh = collectSnoozeMatches(
			parent.text ?? "",
			/* inherited */ true
		);
		if (inh.length && applies(inh, /* isGlobalCheck */ true)) {
			return true;
		}
		parentId = parent._parentId;
	}

	return false;
};

/**
 * Returns whether a task is active for a specific member alias.
 * - active=true: must have active-{alias} and NOT have inactive-{alias}
 * - active=false: returns true if has inactive-{alias}
 * If alias is missing/null, returns false (cannot determine membership).
 */
export const activeForMember = (
	task: TaskItem,
	active = true,
	selectedAlias?: string | null
): boolean => {
	const txt = task?.text ?? "";
	if (!selectedAlias) return false;
	const alias = escapeRegExp(String(selectedAlias));
	const activePattern = new RegExp(
		`\\b${escapeRegExp(Tokens.ActivePrefix)}${alias}(?![\\w-])`,
		"i"
	);
	const inactivePattern = new RegExp(
		`\\b${escapeRegExp(Tokens.InactivePrefix)}${alias}(?![\\w-])`,
		"i"
	);
	const hasActive = activePattern.test(txt);
	const hasInactive = inactivePattern.test(txt);
	return active ? hasActive && !hasInactive : hasInactive;
};

/**
 * Returns true if the task is assigned to any user (has an active-<alias> tag).
 */
export const isAssignedToAnyUser = (task: TaskItem): boolean => {
	const txt = task?.text ?? "";
	return /\bactive-[\w-]+(?![\w-])/.test(txt);
};

/**
 * Returns true if the task is assigned to the provided member alias OR is an active team task.
 * Note: If selectedAlias is not provided, only the team check applies.
 */
export const isAssignedToMemberOrTeam = (
	task: TaskItem,
	selectedAlias?: string | null
): boolean => {
	const txt = task?.text ?? "";

	const hasActiveTeam =
		/\bactive-team\b/i.test(txt) ||
		/class\s*=\s*["'][^"']*\bactive-team\b[^"']*["']/i.test(txt);

	return hasActiveTeam || activeForMember(task, true, selectedAlias);
};

/**
 * Extracts the target date from a 🎯 YYYY-MM-DD marker, or returns false if absent.
 * Returns the raw string "YYYY-MM-DD" if present.
 */
export const hasTargetDate = (task: TaskItem): string | false => {
	const txt = task?.text ?? "";
	const m = txt.match(
		new RegExp(`${escapeRegExp("🎯")}\\s*(${DateRe.source})`)
	);
	return m ? m[1] : false;
};
