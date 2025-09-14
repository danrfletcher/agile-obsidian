import { TaskItem } from "@features/tasks";
import { Tokens } from "./types";
import { escapeRegExp } from "@utils";
import {
	DateRe,
	parseYyyyMmDd,
	todayAtMidnight,
} from "@features/task-date-manager";

/**
 * Utility: parse new inline assignee wrappers from a task line.
 * We only need the opening tag's attributes.
 */
type AssigneeSpan = {
	assignType: "assignee" | "delegate" | null;
	assignmentState: "active" | "inactive" | null;
	memberSlug: string | null;
	memberType?: string | null;
};

function getAttr(tag: string, name: string): string | null {
	const re1 = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i");
	const m1 = re1.exec(tag);
	if (m1) return m1[1] ?? null;
	const re2 = new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, "i");
	const m2 = re2.exec(tag);
	return m2 ? m2[1] ?? null : null;
}

function parseAssigneeSpans(text: string | undefined | null): AssigneeSpan[] {
	if (!text || typeof text !== "string") return [];
	const out: AssigneeSpan[] = [];
	const openTagRe =
		/<span\b[^>]*data-template-key\s*=\s*["']members\.assignee["'][^>]*>/gi;
	for (const m of text.matchAll(openTagRe)) {
		const tag = m[0] ?? "";
		const assignTypeRaw = (
			getAttr(tag, "data-assign-type") || ""
		).toLowerCase();
		const assignmentStateRaw = (
			getAttr(tag, "data-assignment-state") || ""
		).toLowerCase();
		const memberSlugRaw = getAttr(tag, "data-member-slug");
		const memberTypeRaw = getAttr(tag, "data-member-type");

		const assignType: "assignee" | "delegate" | null =
			assignTypeRaw === "assignee" || assignTypeRaw === "delegate"
				? (assignTypeRaw as "assignee" | "delegate")
				: null;

		const assignmentState: "active" | "inactive" | null =
			assignmentStateRaw === "active" || assignmentStateRaw === "inactive"
				? (assignmentStateRaw as "active" | "inactive")
				: null;

		out.push({
			assignType,
			assignmentState,
			memberSlug: memberSlugRaw ? memberSlugRaw.trim() : null,
			memberType: memberTypeRaw ? memberTypeRaw.trim() : null,
		});
	}
	return out;
}

/**
 * Checks if a task is completed using the new format only:
 * - ✅ marker, with optional space and optional date:
 *   "✅ 2025-01-31", "✅2025-01-31", or just "✅"
 */
export const isCompleted = (task: TaskItem): boolean => {
	const txt = task?.text ?? "";
	const completedEmoji = escapeRegExp(Tokens.CompletedEmoji);
	const completedWithOptionalDate = new RegExp(
		`${completedEmoji}(?:\\s?${DateRe.source})?`
	);
	return completedWithOptionalDate.test(txt);
};

/**
 * Checks if a task is cancelled using the new format only:
 * - ❌ marker, with optional space and optional date:
 *   "❌ 2025-01-31", "❌2025-01-31", or just "❌"
 */
export const isCancelled = (task: TaskItem): boolean => {
	const txt = task?.text ?? "";
	const cancelledEmoji = escapeRegExp(Tokens.CancelledEmoji);
	const cancelledWithOptionalDate = new RegExp(
		`${cancelledEmoji}(?:\\s?${DateRe.source})?`
	);
	return cancelledWithOptionalDate.test(txt);
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
		const rawAlias = (m[1] ?? null) as string | null;
		matches.push({
			alias: typeof rawAlias === "string" ? rawAlias.trim() : null,
			date: m[2] ?? null,
		});
	}
	return matches;
}

/**
 * Returns true if the task is snoozed either directly or by inheritance from ancestors.
 * New-format only:
 * - Global snooze (no alias) applies to everyone until date (if provided). Without date, indefinite.
 * - Alias-specific snooze applies only to selectedAlias (hidden within a display:none span).
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

	const applies = (matches: SnoozeMatch[], allowGlobal: boolean): boolean => {
		// Global snooze (no alias)
		const global = matches.find((m) => !m.alias);
		if (global && allowGlobal) {
			const until = parseYyyyMmDd(global.date ?? undefined);
			if (!global.date) return true;
			if (until && until > today) return true;
		}
		if (selectedAlias) {
			const aliasMatch = matches.find(
				(m) =>
					(m.alias ?? "").trim().toLowerCase() ===
					selectedAlias.toLowerCase()
			);
			if (aliasMatch) {
				const until = parseYyyyMmDd(aliasMatch.date ?? undefined);
				if (!aliasMatch.date) return true;
				if (until && until > today) return true;
			}
		}
		return false;
	};

	// Direct snoozes
	const direct = collectSnoozeMatches(task.text, /* inherited */ false);
	if (direct.length && applies(direct, /* allowGlobal */ true)) {
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
		if (inh.length && applies(inh, /* allowGlobal */ true)) {
			return true;
		}
		parentId = parent._parentId;
	}

	return false;
};

/**
 * Returns whether a task is active for a specific member alias.
 * New-format only via inline wrappers:
 * <span data-template-key="members.assignee"
 *       data-assign-type="assignee"
 *       data-assignment-state="active|inactive"
 *       data-member-slug="<alias>">...</span>
 *
 * Semantics:
 * - active=true => must have an active marker and NOT have an inactive marker for the alias
 * - active=false => returns true if it has an inactive marker for the alias
 */
export const activeForMember = (
	task: TaskItem,
	active = true,
	selectedAlias?: string | null
): boolean => {
	const txt = task?.text ?? "";
	if (!selectedAlias) return false;

	const spans = parseAssigneeSpans(txt);
	const aliasLower = String(selectedAlias).toLowerCase();

	const hasActiveNew = spans.some(
		(s) =>
			s.assignType === "assignee" &&
			s.assignmentState === "active" &&
			(s.memberSlug ?? "").toLowerCase() === aliasLower
	);
	const hasInactiveNew = spans.some(
		(s) =>
			s.assignType === "assignee" &&
			s.assignmentState === "inactive" &&
			(s.memberSlug ?? "").toLowerCase() === aliasLower
	);

	if (active) {
		return hasActiveNew && !hasInactiveNew;
	} else {
		return hasInactiveNew;
	}
};

/**
 * Returns true if the task is assigned to any user.
 * New-format only via "assignee" wrappers.
 */
export const isAssignedToAnyUser = (task: TaskItem): boolean => {
	const txt = task?.text ?? "";
	const spans = parseAssigneeSpans(txt);
	return spans.some(
		(s) =>
			s.assignType === "assignee" &&
			s.assignmentState === "active" &&
			!!s.memberSlug
	);
};

/**
 * Returns true if the task is assigned to the provided member alias OR is an active team task.
 * New-format only:
 * - "Everyone" assignee via wrapper
 * - Member-specific via activeForMember
 */
export const isAssignedToMemberOrTeam = (
	task: TaskItem,
	selectedAlias?: string | null
): boolean => {
	const txt = task?.text ?? "";
	const spans = parseAssigneeSpans(txt);

	const hasEveryoneActiveNew = spans.some(
		(s) =>
			s.assignType === "assignee" &&
			s.assignmentState === "active" &&
			(s.memberSlug ?? "").toLowerCase() === "everyone"
	);

	return hasEveryoneActiveNew || activeForMember(task, true, selectedAlias);
};

/**
 * Returns true if task text is empty
 */
export const isBlankTask = (task: TaskItem): boolean => {
	const txt = task?.text;
	if (typeof txt !== "string") return true;
	return txt.trim().length === 0;
};

/**
 * Schedule parsing: detect day-of-week schedules like:
 * - "🗓️ Sundays" / "🗓️ Sunday" (case-insensitive)
 * - "🗓 Sundays:" (with punctuation)
 * - "🗓️ Mon-Fri", "🗓️ Monday–Friday", "🗓️ Weekdays"
 * - "🗓️ Weekends" (Sat + Sun)
 * - "🗓️ Daily", "🗓️ Every day"
 * - Lists: "🗓️ Mon, Wed, Fri", "🗓️ Tuesday and Thursday"
 *
 * Notes:
 * - We only parse up to the next markup "<" to avoid pulling in HTML tags.
 * - Multiple calendar markers are supported; if any includes today, we return true.
 * - We accept both 🗓 and 🗓️ (with VS16) and common alternatives 📅, 📆
 */
const DOW_NAMES: Record<string, number> = {
	sun: 0,
	sunday: 0,
	mon: 1,
	monday: 1,
	tue: 2,
	tues: 2,
	tuesday: 2,
	wed: 3,
	weds: 3,
	wednesday: 3,
	thu: 4,
	thur: 4,
	thurs: 4,
	thursday: 4,
	fri: 5,
	friday: 5,
	sat: 6,
	saturday: 6,
};

function normalizeWord(w: string): string {
	return w.toLowerCase().replace(/[^a-z]/g, "");
}

function expandRange(start: number, end: number): number[] {
	// Inclusive, circular week
	const out: number[] = [];
	let cur = start;
	out.push(cur);
	while (cur !== end) {
		cur = (cur + 1) % 7;
		out.push(cur);
	}
	return out;
}

function parseScheduleChunk(rawChunk: string): Set<number> {
	const days = new Set<number>();
	const raw = rawChunk.toLowerCase().trim();

	// Simple buckets
	if (/\bdaily\b|\bevery\s*day\b/.test(raw)) {
		[0, 1, 2, 3, 4, 5, 6].forEach((d) => days.add(d));
		return days;
	}
	if (
		/\bweekdays?\b/.test(raw) ||
		/\bmonday\s*[-–]\s*friday\b/.test(raw) ||
		/\bmon\s*[-–]\s*fri\b/.test(raw)
	) {
		[1, 2, 3, 4, 5].forEach((d) => days.add(d));
		return days;
	}
	if (
		/\bweekends?\b/.test(raw) ||
		/\bsat\s*[-–]\s*sun\b/.test(raw) ||
		/\bsaturday\s*[-–]\s*sunday\b/.test(raw)
	) {
		[6, 0].forEach((d) => days.add(d));
		return days;
	}

	// Ranges like "Mon–Fri", "Thu-Sun"
	const rangeRe =
		/(sun|sunday|mon|monday|tue|tues|tuesday|wed|weds|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday)\s*[-–]\s*(sun|sunday|mon|monday|tue|tues|tuesday|wed|weds|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday)/gi;
	for (const m of raw.matchAll(rangeRe)) {
		const a = DOW_NAMES[normalizeWord(m[1])];
		const b = DOW_NAMES[normalizeWord(m[2])];
		if (a !== undefined && b !== undefined) {
			expandRange(a, b).forEach((d) => days.add(d));
		}
	}

	// Expressions like "Every Sunday", "On Tuesday and Thursday"
	const cleaned = raw
		.replace(/\bevery\b/gi, " ")
		.replace(/\bon\b/gi, " ")
		.replace(/[:.;,]+/g, " ");

	// Individual days list: split on commas/and/slashes/spaces and collect
	const tokens = cleaned
		.split(/[,/]|(?:\band\b)/gi)
		.flatMap((t) => t.split(/\s+/))
		.map((t) => normalizeWord(t.replace(/s\b/, ""))) // remove trailing plural 's'
		.filter(Boolean);

	for (const tok of tokens) {
		const d = DOW_NAMES[tok];
		if (d !== undefined) days.add(d);
	}

	return days;
}

/**
 * Returns true when the task text contains a recognized calendar schedule marker.
 * We accept 🗓, 🗓️, 📅, 📆.
 */
export function hasCalendarScheduleMarker(task: TaskItem): boolean {
	const txt = task?.text ?? "";
	if (!txt) return false;
	// u-flag for proper unicode handling
	const markerRe = /(?:🗓️|🗓|📅|📆)/u;
	return markerRe.test(txt);
}

export function isScheduledForToday(
	task: TaskItem,
	date = new Date()
): boolean {
	const txt = task?.text ?? "";
	if (!txt) return false;

	// Match any of the accepted calendar markers followed by the schedule text until markup/newline
	const re = /(?:🗓️|🗓|📅|📆)\s*([^<\n\r]*)/giu;

	const today = date.getDay(); // 0=Sun ... 6=Sat

	for (const m of txt.matchAll(re)) {
		const chunk = (m[1] ?? "").trim();
		if (!chunk) continue;
		const days = parseScheduleChunk(chunk);
		if (days.has(today)) {
			return true;
		}
	}
	return false;
}

/**
 * Extra helpers you can use in your dashboard predicates
 */

// Simple checkbox-open heuristic for markdown task lines beginning with "- [ ]"
export function isMarkdownCheckboxOpen(task: TaskItem): boolean {
	const txt = task?.text ?? "";
	return /^\s*-\s*\[\s\]/.test(txt);
}

// Decision function for recurring responsibilities
export function shouldShowRecurringResponsibility(
	task: TaskItem,
	taskMap: Map<string, TaskItem>,
	options?: {
		selectedAlias?: string | null;
		date?: Date;
		requireAssignee?: boolean; // default true
		requireScheduleToday?: boolean; // default true, but enforced only if a calendar marker exists
		requireOpenCheckbox?: boolean; // default false
	}
): boolean {
	const {
		selectedAlias,
		date = new Date(),
		requireAssignee = true,
		requireScheduleToday = true,
		requireOpenCheckbox = false,
	} = options ?? {};

	// Base state
	if (!isInProgress(task, taskMap)) return false;

	// Optional checkbox gating (some dashboards want "- [ ]" explicitly)
	if (requireOpenCheckbox && !isMarkdownCheckboxOpen(task)) return false;

	// Assignee gating
	if (requireAssignee && !isAssignedToMemberOrTeam(task, selectedAlias)) {
		return false;
	}

	// Schedule gating — only enforce DOW if a calendar marker exists on the line
	if (requireScheduleToday && hasCalendarScheduleMarker(task)) {
		if (!isScheduledForToday(task, date)) {
			return false;
		}
	}

	return true;
}

// Debug object to log exactly which checks pass/fail
export function debugRecurringResDecision(
	task: TaskItem,
	taskMap: Map<string, TaskItem>,
	options?: {
		selectedAlias?: string | null;
		date?: Date;
		requireAssignee?: boolean;
		requireScheduleToday?: boolean;
		requireOpenCheckbox?: boolean;
	}
) {
	const {
		selectedAlias,
		date = new Date(),
		requireAssignee = true,
		requireScheduleToday = true,
		requireOpenCheckbox = false,
	} = options ?? {};

	const state = {
		text: (task?.text ?? "").slice(0, 240),
		isCompleted: isCompleted(task),
		isCancelled: isCancelled(task),
		isSnoozed: isSnoozed(task, taskMap, selectedAlias || undefined),
		isInProgress: isInProgress(task, taskMap),
		isMarkdownCheckboxOpen: isMarkdownCheckboxOpen(task),
		isAssignedToMemberOrTeam: isAssignedToMemberOrTeam(task, selectedAlias),
		hasCalendarScheduleMarker: hasCalendarScheduleMarker(task),
		isScheduledForToday: isScheduledForToday(task, date),
		requireAssignee,
		requireScheduleToday,
		requireOpenCheckbox,
		selectedAlias: selectedAlias ?? null,
		todayDOW: date.getDay(),
	};
	const result = shouldShowRecurringResponsibility(task, taskMap, {
		selectedAlias,
		date,
		requireAssignee,
		requireScheduleToday,
		requireOpenCheckbox,
	});
	return { ...state, result };
}
