import type {
	TemplateContext,
	TemplateInsertErrorDetails,
	TemplateDefinition,
	Rule,
	RuleObject,
	AllowedOn,
	ParamsSchema,
} from "../domain/types";
import { TemplateInsertError } from "../domain/types";
import { presetTemplates } from "../domain/presets";
import { evaluateRules, normalizeRules } from "../domain/rules";
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
 * Resolve the UI modal title for a params schema.
 */
export function resolveModalTitleFromSchema(
	schema: ParamsSchema | undefined,
	mode?: boolean | string
): string | undefined {
	if (!schema) return undefined;

	if (mode !== undefined) {
		const key = typeof mode === "string" ? mode : mode ? "edit" : "create";
		type TitleKey = keyof NonNullable<ParamsSchema["titles"]>; // "create" | "edit"
		const candidate = schema.titles?.[key as TitleKey];
		return candidate ?? schema.title;
	}
	return schema.title;
}

/**
 * Find a template definition by its id, e.g. "agile.userStory".
 */
function findTemplateById(id: string) {
	const [group, key] = id.split(".");
	const groupObj = (presetTemplates as Record<string, any>)[group];
	if (!groupObj) return undefined;
	return groupObj[key];
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
	} catch (e: any) {
		const details: TemplateInsertErrorDetails = {
			code: "NOT_ALLOWED_HERE",
			messages: e?.messages ?? [],
			foundAncestors: e?.ancestors,
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
	} catch (err: any) {
		throw new TemplateInsertError(
			`Render failed for ${templateId}: ${err?.message ?? String(err)}`,
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
		editor: editor as any,
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
      const parsed = def.parseParamsFromDom(wrapperEl) as Record<string, unknown> | undefined;
      if (parsed && Object.keys(parsed).length > 0) return parsed;
    } catch {
      // fall through
    }
  }

  // Generic: explicit var markers only
  const explicit = extractParamsFromWrapperEl(wrapperEl);
  if (Object.keys(explicit).length > 0) return explicit;

  // No markers found. Enforce “wrapped vars only”.
  console.warn(
    "[templating] No [data-tpl-var] markers found for parameterized template:",
    templateId,
    wrapperEl
  );
  return {};
}

/**
 * Replace the first template wrapper on the current editor line with newHtml.
 * Uses instanceId if provided for precise matching; otherwise falls back to templateKey.
 */
export async function replaceTemplateWrapperOnCurrentLine(
  app: any,
  view: any,
  editor: MinimalEditor,
  templateKey: string,
  newHtml: string,
  wrapperInstanceId?: string
): Promise<void> {
  try {
    const cur = editor.getCursor();
    const lineNo = cur.line;
    const lineText = editor.getLine(lineNo);

    // Prefer matching by data-template-wrapper (unique per instance)
    const openTagRe = new RegExp(
      wrapperInstanceId
        ? `<span\\b[^>]*\\bdata-template-wrapper\\s*=\\s*"${escapeRegExp(wrapperInstanceId)}"[^>]*>`
        : `<span\\b[^>]*\\bdata-template-key\\s*=\\s*"${escapeRegExp(templateKey)}"[^>]*>`,
      "i"
    );

    const openMatch = openTagRe.exec(lineText);
    if (!openMatch) {
      console.debug(
        "[templating] replaceTemplateWrapperOnCurrentLine: wrapper not found on line",
        { lineNo, templateKey, wrapperInstanceId, lineText }
      );
      return;
    }

    const startIdx = openMatch.index;

    // Find the end index of the matching </span> for this wrapper via deterministic counting
    const endIdx = findMatchingSpanEndIndexDeterministic(lineText, startIdx);
    if (endIdx === -1) {
      console.warn(
        "[templating] replaceTemplateWrapperOnCurrentLine: could not find matching </span> for wrapper",
        { lineNo, templateKey, wrapperInstanceId }
      );
      return;
    }

    const updated = lineText.slice(0, startIdx) + newHtml + lineText.slice(endIdx);

    const from = { line: lineNo, ch: 0 };
    const to = { line: lineNo, ch: lineText.length };
    editor.replaceRange(updated, from, to);

    // Place caret at end of line to avoid caret jumping inside HTML
    if (typeof editor.setCursor === "function") {
      editor.setCursor({ line: lineNo, ch: updated.length });
    }
  } catch (e) {
    console.error("[templating] replaceTemplateWrapperOnCurrentLine error", e);
  }
}

/**
 * Deterministic scanner: starting at the given '<span ...>' opening tag, walk the line
 * and count '<span' vs '</span>' to find the matching closing position.
 * This avoids regex corner cases with nested spans.
 */
function findMatchingSpanEndIndexDeterministic(s: string, startIdx: number): number {
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