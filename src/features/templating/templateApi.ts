// templateApi.ts
import type {
	TemplateContext,
	TemplateInsertErrorDetails,
	TemplateDefinition,
	Rule,
	RuleObject,
} from "./types";
import { TemplateInsertError } from "./types";
import { presetTemplates } from "./presets";
import { evaluateRules } from "./rules";
import { getParentChainTemplateIds } from "src/utils/fs/editorUtils";
import type { Editor } from "obsidian";
import { getLineKind } from "src/utils/fs/fsUtils";

type AllowedOn = "task" | "list" | "any";

function normalizeAllowedOn(tpl: TemplateDefinition): AllowedOn[] {
	// If rules missing, allow anywhere
	const r = tpl.rules as any;
	const allowed = r?.allowedOn;
	if (!allowed) return ["any"];
	if (Array.isArray(allowed)) return allowed as AllowedOn[];
	// If provided as scalar object
	const arr = allowed as unknown as AllowedOn[] | AllowedOn;
	return Array.isArray(arr) ? arr : [arr];
}

export function findTemplateById(id: string) {
	const [group, key] = id.split(".");
	const groupObj = (presetTemplates as Record<string, any>)[group];
	if (!groupObj) return undefined;
	return groupObj[key];
}

// Helper: coerce Rule (union) to a single RuleObject for error reporting
function coerceRuleObject(rule: Rule | undefined): RuleObject | undefined {
	if (!rule) return undefined;
	return Array.isArray(rule) ? rule[0] : rule;
}

// Append a trailing space if rendered ends with a tag/angle bracket.
// Avoid double spaces if the existing line already ends with a space.
function withTrailingSpace(
	rendered: string,
	existingLineEndHasSpace: boolean
): string {
	const endsWithAngle = /\>\s*$/.test(rendered);
	if (!endsWithAngle) return rendered;
	return existingLineEndHasSpace ? rendered : `${rendered} `;
}

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
			{
				code: "UNKNOWN_TEMPLATE",
			}
		);
	}

	// Evaluate rules at business-logic level (structure/parents/etc.)
	const rules = tpl.rules;
	try {
		evaluateRules(ctx, rules, getParentChainTemplateIds);
	} catch (e: any) {
		const details: TemplateInsertErrorDetails = {
			code: "NOT_ALLOWED_HERE",
			messages: e?.messages ?? [],
			foundAncestors: e?.ancestors,
		};
		// For error shaping, look at a single rule object
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
		// Merge per-template defaults (if any) with provided params
		const finalParams = tpl.defaults
			? ({
					...tpl.defaults,
					...(params as Record<string, unknown> | undefined),
			  } as TParams)
			: params;

		// Render inline content; no task/list prefix here
		return tpl.render(finalParams);
	} catch (err: any) {
		throw new TemplateInsertError(
			`Render failed for ${templateId}: ${err?.message ?? String(err)}`,
			{ code: "RENDER_FAILED" }
		);
	}
}

/**
 Insertion at cursor with rule-aware wrapping:
 - Templates render inline only
 - We wrap the current line only if necessary and permitted
*/
export function insertTemplateAtCursor<TParams = unknown>(
	templateId: string,
	editor: Editor,
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
		editor,
	};

	const tpl = findTemplateById(templateId) as TemplateDefinition | undefined;
	if (!tpl || typeof tpl !== "object" || typeof tpl.render !== "function") {
		throw new TemplateInsertError(
			`Unknown or invalid template: ${templateId}`,
			{
				code: "UNKNOWN_TEMPLATE",
			}
		);
	}

	// Run business rule evaluation first (parent/top-level, etc.)
	const renderedRaw = insertTemplate(templateId, ctx, params);
	const allowed = normalizeAllowedOn(tpl);

	// Compute trailing-space variant once; we’ll pass line-ending awareness per usage
	const lineEndsWithSpace = /\s$/.test(lineText);

	// Helper to replace the entire current line
	const replaceLine = (text: string) => {
		const from = { line: cursor.line, ch: 0 };
		const to = { line: cursor.line, ch: lineText.length };
		editor.replaceRange(text, from, to);
	};

	// Append inline to an existing line
	const appendInline = () => {
		const from = { line: cursor.line, ch: 0 };
		const to = { line: cursor.line, ch: lineText.length };

		// If current line is empty, we don't need a joining space before rendered,
		// but we still may want a trailing space after the rendered content.
		if (lineText.length === 0) {
			const rendered = withTrailingSpace(renderedRaw, false);
			editor.replaceRange(rendered, from, to);
			return;
		}

		// Non-empty line: add a single space separator before rendered,
		// and then consider trailing space after rendered (avoid double).
		const joiner = lineEndsWithSpace ? "" : " ";
		const rendered = withTrailingSpace(renderedRaw, false);
		const next = `${lineText}${joiner}${rendered}`;
		editor.replaceRange(next, from, to);
	};

	// Decide based on allowed and current lineKind
	const allowTask = allowed.includes("task");
	const allowList = allowed.includes("list");
	const allowAny = allowedOnIncludesAny(allowed);

	if (allowAny) {
		// Anywhere: do not auto-create task/list; just inline
		return appendInline();
	}

	// Task-only or List-only logic
	if (allowTask && !allowList) {
		if (lineKind === "task") {
			return appendInline();
		}
		if (lineKind === "empty") {
			// Convert the line into a task line
			const rendered = withTrailingSpace(renderedRaw, false);
			return replaceLine(`- [ ] ${rendered}`);
		}
		// Currently non-task content. Per your requirement: block insertion.
		throw new TemplateInsertError(
			"Template allowed only on task lines; current line is not a task.",
			{ code: "NOT_ALLOWED_HERE", messages: ["Requires a task line"] }
		);
	}

	if (allowList && !allowTask) {
		if (lineKind === "list") {
			return appendInline();
		}
		if (lineKind === "empty") {
			// Convert to a list line
			const rendered = withTrailingSpace(renderedRaw, false);
			return replaceLine(`- ${rendered}`);
		}
		// Non-list content => block
		throw new TemplateInsertError(
			"Template allowed only on list lines; current line is not a list.",
			{ code: "NOT_ALLOWED_HERE", messages: ["Requires a list line"] }
		);
	}

	// Either task or list
	if (allowTask && allowList) {
		if (lineKind === "task" || lineKind === "list") {
			return appendInline();
		}
		if (lineKind === "empty") {
			// Default to list if truly either
			const rendered = withTrailingSpace(renderedRaw, false);
			return replaceLine(`- ${rendered}`);
		}
		// Plain text line: block to avoid surprising structure changes
		throw new TemplateInsertError(
			"Template requires a task or list line.",
			{
				code: "NOT_ALLOWED_HERE",
				messages: ["Requires task or list line"],
			}
		);
	}

	// Fallback (shouldn't hit)
	return appendInline();
}

function allowedOnIncludesAny(allowed: AllowedOn[]): boolean {
	return allowed.includes("any");
}
