import type {
	TemplateContext,
	TemplateInsertErrorDetails,
	TemplateDefinition,
	Rule,
	RuleObject,
	AllowedOn,
} from "../domain/types";
import { TemplateInsertError } from "../domain/types";
import { presetTemplates } from "../domain/presets";
import {
	evaluateRules,
	normalizeRules,
	RulesViolationError,
} from "../domain/rules";
import { getArtifactParentChainTemplateIds } from "../domain/task-template-parent-chain";
import { getLineKind } from "@platform/obsidian";
import { extractParamsFromWrapperEl } from "../domain/template-parameter-helpers";
import { escapeRegExp } from "@utils";

export type WrapperInfo = {
	templateKey: string | null;
	orderTag: string | null;
};

/**
 * Minimal Editor shape used within templating. Avoids importing Obsidian Editor directly.
 */
type MinimalEditor = {
	getCursor(): { line: number; ch: number };
	getLine(line: number): string;
	replaceRange(
		text: string,
		from: { line: number; ch: number },
		to?: { line: number; ch: number }
	): void;
	getValue(): string;
	setCursor?(pos: { line: number; ch: number }): void;
};

/**
 * Robust template resolver that supports:
 * - Canonical "group.key" lookups (fast-path).
 * - Multi-dot ids like "workflows.states.blocked" by matching against def.id.
 * - Fallback to using the last segment as the key within the group.
 * - As a final fallback, scans all groups for a def with a matching def.id.
 */
export function findTemplateById(id: string): TemplateDefinition | undefined {
	if (!id) return undefined;

	// Extract group (first segment)
	const firstDot = id.indexOf(".");
	const group = firstDot >= 0 ? id.slice(0, firstDot) : id;

	const groups = presetTemplates as unknown as Record<
		string,
		Record<string, TemplateDefinition>
	>;
	const groupObj = groups[group];

	// If group exists, attempt a series of targeted resolutions
	if (groupObj) {
		// 1) Try exact "group.remainder" where remainder may contain dots (e.g., "states.blocked")
		const remainder =
			firstDot >= 0 && firstDot + 1 < id.length
				? id.slice(firstDot + 1)
				: "";
		if (remainder && groupObj[remainder]) {
			return groupObj[remainder];
		}

		// 2) Try last segment within the group (e.g., key "blocked")
		const parts = id.split(".");
		const last = parts[parts.length - 1];
		if (last && groupObj[last]) {
			return groupObj[last];
		}

		// 3) Search the group's definitions by exact def.id match
		for (const def of Object.values(groupObj)) {
			if (def?.id === id) return def;
		}
	}

	// 4) As a final fallback, scan all groups by def.id
	for (const defs of Object.values(
		presetTemplates as unknown as Record<
			string,
			Record<string, TemplateDefinition>
		>
	)) {
		for (const def of Object.values(defs)) {
			if (def?.id === id) return def;
		}
	}

	return undefined;
}

function coerceRuleObject(rule: Rule | undefined): RuleObject | undefined {
	if (!rule) return undefined;
	return Array.isArray(rule) ? rule[0] : rule;
}

/**
 * Ensure inline template renderings have a trailing space when needed.
 */
function withTrailingSpace(
	rendered: string,
	existingLineEndHasSpace: boolean
): string {
	const endsWithAngle = />\s*$/.test(rendered);
	if (!endsWithAngle) return rendered;
	return existingLineEndHasSpace ? rendered : `${rendered} `;
}

/**
 * Normalize template's allowed-on rules to a concrete list.
 */
function normalizeAllowedOnRules(tpl: TemplateDefinition): AllowedOn[] {
	const variants = normalizeRules(tpl.rules);
	if (variants.length === 0) return ["any"];

	let hasAny = false;
	const set = new Set<AllowedOn>();
	for (const v of variants) {
		const allowed = v.allowedOn;
		if (!allowed || allowed.includes("any")) {
			hasAny = true;
			break;
		}
		for (const a of allowed) set.add(a);
	}
	return hasAny ? ["any"] : Array.from(set);
}

/**
 * Render a template with rules enforcement.
 */
export function insertTemplate<TParams = unknown>(
	templateId: string,
	ctx: TemplateContext,
	params?: TParams
): string {
	const tpl = findTemplateById(templateId) as
		| TemplateDefinition<TParams>
		| undefined;
	if (!tpl || typeof tpl !== "object" || typeof tpl.render !== "function") {
		throw new TemplateInsertError(
			`Unknown or invalid template: ${templateId}`,
			{ code: "UNKNOWN_TEMPLATE" }
		);
	}

	const rules = tpl.rules;
	try {
		evaluateRules(ctx, rules, getArtifactParentChainTemplateIds);
	} catch (e) {
		const violation =
			e instanceof RulesViolationError ? e : undefined;

		const details: TemplateInsertErrorDetails = {
			code: "NOT_ALLOWED_HERE",
			messages: violation?.messages ?? [],
			foundAncestors: violation?.ancestors,
		};
		const r0 = coerceRuleObject(rules);
		if (Array.isArray(r0?.parent)) {
			details.requiredParents = r0!.parent!;
			details.code = "PARENT_MISSING";
		} else if (r0?.topLevel) {
			details.code = "TOP_LEVEL_ONLY";
		}
		throw new TemplateInsertError(
			`Cannot insert ${templateId} here.`,
			details
		);
	}

	try {
		const finalParams = tpl.defaults
			? ({
					...tpl.defaults,
					...(params as Record<string, unknown> | undefined),
			  } as TParams)
			: params;
		return tpl.render(finalParams);
	} catch (err) {
		const message =
			err instanceof Error ? err.message : String(err);
		throw new TemplateInsertError(
			`Render failed for ${templateId}: ${message}`,
			{ code: "RENDER_FAILED" }
		);
	}
}

/**
 * Insert a template at cursor, coercing the line to allowed type.
 */
export function insertTemplateAtCursor<TParams = unknown>(
	templateId: string,
	editor: MinimalEditor,
	filePath: string,
	params?: TParams
) {
	const cursor = editor.getCursor();
	const lineText = editor.getLine(cursor.line);
	const lineKind = getLineKind(lineText);

	const ctx: TemplateContext = {
		line: lineText,
		file: editor.getValue(),
		path: filePath,
		// editor intentionally omitted to keep this helper decoupled from Obsidian's Editor type
	};

	const tpl = findTemplateById(templateId) as TemplateDefinition | undefined;
	if (!tpl || typeof tpl !== "object" || typeof tpl.render !== "function") {
		throw new TemplateInsertError(
			`Unknown or invalid template: ${templateId}`,
			{ code: "UNKNOWN_TEMPLATE" }
		);
	}

	const renderedRaw = insertTemplate(templateId, ctx, params);
	const allowed = normalizeAllowedOnRules(tpl);
	const lineEndsWithSpace = /\s$/.test(lineText);

	const replaceLine = (text: string) => {
		const from = { line: cursor.line, ch: 0 };
		const to = { line: cursor.line, ch: lineText.length };
		editor.replaceRange(text, from, to);
	};

	const appendInline = () => {
		const from = { line: cursor.line, ch: 0 };
		const to = { line: cursor.line, ch: lineText.length };
		if (lineText.length === 0) {
			const rendered = withTrailingSpace(renderedRaw, false);
			editor.replaceRange(rendered, from, to);
			return;
		}
		const joiner = lineEndsWithSpace ? "" : " ";
		const rendered = withTrailingSpace(renderedRaw, false);
		const next = `${lineText}${joiner}${rendered}`;
		editor.replaceRange(next, from, to);
	};

	const allowTask = allowed.includes("task");
	const allowList = allowed.includes("list");
	const allowAny = allowed.includes("any");

	if (allowAny) return appendInline();

	if (allowTask && !allowList) {
		if (lineKind === "task") return appendInline();
		if (lineKind === "empty") {
			const rendered = withTrailingSpace(renderedRaw, false);
			return replaceLine(`- [ ] ${rendered}`);
		}
		throw new TemplateInsertError(
			"Template allowed only on task lines; current line is not a task.",
			{ code: "NOT_ALLOWED_HERE", messages: ["Requires a task line"] }
		);
	}

	if (allowList && !allowTask) {
		if (lineKind === "list") return appendInline();
		if (lineKind === "empty") {
			const rendered = withTrailingSpace(renderedRaw, false);
			return replaceLine(`- ${rendered}`);
		}
		throw new TemplateInsertError(
			"Template allowed only on list lines; current line is not a list.",
			{ code: "NOT_ALLOWED_HERE", messages: ["Requires a list line"] }
		);
	}

	if (allowTask && allowList) {
		if (lineKind === "task" || lineKind === "list") return appendInline();
		if (lineKind === "empty") {
			const rendered = withTrailingSpace(renderedRaw, false);
			return replaceLine(`- ${rendered}`);
		}
		throw new TemplateInsertError(
			"Template requires a task or list line.",
			{
				code: "NOT_ALLOWED_HERE",
				messages: ["Requires task or list line"],
			}
		);
	}

	return appendInline();
}

/**
 * Render without touching the editor. Rules aren’t evaluated here.
 */
export function renderTemplateOnly<TParams = unknown>(
	templateId: string,
	params?: TParams
): string {
	const tpl = findTemplateById(templateId) as
		| TemplateDefinition<TParams>
		| undefined;
	if (!tpl || typeof tpl !== "object" || typeof tpl.render !== "function") {
		throw new TemplateInsertError(
			`Unknown or invalid template: ${templateId}`,
			{ code: "UNKNOWN_TEMPLATE" }
		);
	}
	const finalParams = tpl.defaults
		? ({
				...tpl.defaults,
				...(params as Record<string, unknown> | undefined),
		  } as TParams)
		: params;
	return tpl.render(finalParams);
}

/**
 * Prefill strictly from explicit variable markers.
 * If a template supplies parseParamsFromDom, it must also return marker-only values.
 */
export function prefillTemplateParams(
	templateId: string,
	wrapperEl: HTMLElement
): Record<string, unknown> | undefined {
	const def = findTemplateById(templateId) as TemplateDefinition | undefined;
	if (!def) return undefined;

	// Template-specific override (must be marker-only)
	if (typeof def.parseParamsFromDom === "function") {
		try {
			const parsed = def.parseParamsFromDom(wrapperEl) as
				| Record<string, unknown>
				| undefined;
			if (parsed && Object.keys(parsed).length > 0) return parsed;
		} catch {
			// fall through
		}
	}

	// Generic: explicit var markers only
	const explicit = extractParamsFromWrapperEl(wrapperEl);
	if (Object.keys(explicit).length > 0) return explicit;

	return {};
}

/**
 * Replace the clicked template wrapper's ENTIRE <span ...>...</span> in the editor.
 * - Prefer matching the exact instance by data-template-wrapper across the entire document.
 * - Fall back to current-line, by data-template-key, only when no instance id is provided.
 * - Uses a deterministic span-matching scanner (single-line assumption for wrappers).
 */
export async function replaceTemplateWrapperOnCurrentLine<TApp, TView>(
	_app: TApp,
	_view: TView,
	editor: MinimalEditor,
	templateKey: string,
	newHtml: string,
	wrapperInstanceId?: string
): Promise<void> {
	try {
		const doc = editor.getValue() ?? "";
		const lines = doc.split(/\r?\n/);

		// Helper: robust attr matcher supporting single or double quotes
		const hasAttrWithValue = (s: string, attr: string, val: string): boolean => {
			const esc = String(val || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			const re = new RegExp(`\\b${attr}\\s*=\\s*(['"])${esc}\\1`, "i");
			return re.test(s);
		};

		// Find the line that actually contains the clicked instance id
		let targetLineNo = -1;
		if (wrapperInstanceId && wrapperInstanceId.trim()) {
			for (let i = 0; i < lines.length; i++) {
				if (
					hasAttrWithValue(
						lines[i] ?? "",
						"data-template-wrapper",
						wrapperInstanceId
					)
				) {
					targetLineNo = i;
					break;
				}
			}
		}

		// Fallback: no instance id or not found -> use current cursor line
		if (targetLineNo < 0) {
			const cur = editor.getCursor();
			targetLineNo = typeof cur?.line === "number" ? cur.line : 0;
		}

		if (targetLineNo < 0 || targetLineNo >= lines.length) {
			console.debug(
				"[templating] replaceTemplateWrapperOnCurrentLine: invalid target line",
				{ templateKey, wrapperInstanceId, targetLineNo }
			);
			return;
		}

		const lineText = editor.getLine(targetLineNo) ?? "";
		if (!lineText || lineText.length === 0) {
			console.debug(
				"[templating] replaceTemplateWrapperOnCurrentLine: empty target line",
				{ templateKey, wrapperInstanceId, targetLineNo }
			);
			return;
		}

		// Build an anchor regex using the strongest selector we have:
		// 1) instance id (preferred), else 2) template key.
		const openTagRe = new RegExp(
			wrapperInstanceId && wrapperInstanceId.trim()
				? `<span\\b[^>]*\\bdata-template-wrapper\\s*=\\s*(['"])${escapeRegExp(
						wrapperInstanceId.trim()
				  )}\\1[^>]*>`
				: `<span\\b[^>]*\\bdata-template-key\\s*=\\s*(['"])${escapeRegExp(
						templateKey
				  )}\\1[^>]*>`,
			"i"
		);

		const openMatch = openTagRe.exec(lineText);
		if (!openMatch) {
			console.debug(
				"[templating] replaceTemplateWrapperOnCurrentLine: wrapper not found on target line",
				{
					lineNo: targetLineNo,
					templateKey,
					wrapperInstanceId,
					lineText,
				}
			);
			return;
		}

		// Find the opening <span ...> start index that contains the anchor
		const anchorPos = openMatch.index;
		let openStart = lineText.lastIndexOf("<span", anchorPos);
		if (openStart < 0) {
			// Be permissive: try forward search from anchor
			openStart = lineText.toLowerCase().indexOf("<span", anchorPos);
			if (openStart < 0) {
				console.debug(
					"[templating] replaceTemplateWrapperOnCurrentLine: opening <span not found",
					{ lineNo: targetLineNo, templateKey, wrapperInstanceId }
				);
				return;
			}
		}

		// Determine the end index of the matching </span> for this wrapper
		const endIdxExclusive = findMatchingSpanEndIndexDeterministic(
			lineText,
			openStart
		);
		if (endIdxExclusive === -1) {
			console.warn(
				"[templating] replaceTemplateWrapperOnCurrentLine: unmatched </span>",
				{ lineNo: targetLineNo, templateKey, wrapperInstanceId }
			);
			return;
		}

		// Replace the ENTIRE wrapper with the provided HTML (which itself is a full wrapper from renderTemplateOnly)
		const updatedLine =
			lineText.slice(0, openStart) + newHtml + lineText.slice(endIdxExclusive);

		// Commit the line replacement
		editor.replaceRange(
			updatedLine,
			{ line: targetLineNo, ch: 0 },
			{ line: targetLineNo, ch: lineText.length }
		);
		editor.setCursor?.({ line: targetLineNo, ch: updatedLine.length });
	} catch (e) {
		console.error(
			"[templating] replaceTemplateWrapperOnCurrentLine error",
			e
		);
	}
}

/**
 * Deterministic scanner: starting at the given '<span ...>' opening tag, walk the line
 * and count '<span' vs '</span>' to find the matching closing position.
 * This avoids regex corner cases with nested spans.
 */
function findMatchingSpanEndIndexDeterministic(
	s: string,
	startIdx: number
): number {
	// Sanity: the startIdx must point at an opening '<span'
	if (s.slice(startIdx, startIdx + 5).toLowerCase() !== "<span") {
		// find the next opening from startIdx just in case
		const firstOpen = s.toLowerCase().indexOf("<span", startIdx);
		if (firstOpen === -1) return -1;
		startIdx = firstOpen;
	}

	// Move to end of the opening tag
	const firstGt = s.indexOf(">", startIdx);
	if (firstGt === -1) return -1;

	let depth = 1;
	let i = firstGt + 1;

	while (i < s.length) {
		const nextOpen = s.toLowerCase().indexOf("<span", i);
		const nextClose = s.toLowerCase().indexOf("</span>", i);

		// No more closing tag: unbalanced
		if (nextClose === -1) return -1;

		// If next opening comes before next closing, it's a nested span
		if (nextOpen !== -1 && nextOpen < nextClose) {
			depth += 1;
			const gt = s.indexOf(">", nextOpen);
			if (gt === -1) return -1;
			i = gt + 1;
			continue;
		}

		// Otherwise we encountered a closing
		depth -= 1;
		const closeEnd = nextClose + "</span>".length;
		if (depth === 0) return closeEnd;
		i = closeEnd;
	}

	return -1;
}