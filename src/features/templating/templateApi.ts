import type { TemplateContext, TemplateInsertErrorDetails } from "./types";
import { TemplateInsertError } from "./types";
import { presetTemplates } from "./presets";
import { evaluateRules } from "./rules";
import { getParentChainTemplateIds } from "src/utils/fs/editorUtils";
import type { Editor } from "obsidian";

/**
 * Find a template definition by dot path id like "agile.userStory".
 * The presetTemplates groups are keyed as:
 *  - agile, crm, members, prioritization, workflows, obsidian
 */
export function findTemplateById(id: string) {
	const [group, key] = id.split(".");
	const groupObj = (presetTemplates as Record<string, any>)[group];
	if (!groupObj) return undefined;
	const leaf = groupObj[key];
	return leaf;
}

export function insertTemplate<TParams = unknown>(
	templateId: string,
	ctx: TemplateContext,
	params?: TParams
): string {
	const tpl = findTemplateById(templateId);
	if (!tpl) {
		throw new TemplateInsertError(`Unknown template: ${templateId}`, {
			code: "UNKNOWN_TEMPLATE",
		});
	}

	// Evaluate rules
	try {
		// NOTE: evaluateRules(ctx, rule, getAncestors)
		evaluateRules(ctx, tpl.rules, getParentChainTemplateIds);
	} catch (e: any) {
		const details: TemplateInsertErrorDetails = {
			code: "NOT_ALLOWED_HERE",
			messages: e?.messages ?? [],
			foundAncestors: e?.ancestors,
		};
		if (Array.isArray((tpl.rules as any)?.parent)) {
			details.requiredParents = (tpl.rules as any).parent;
			details.code = "PARENT_MISSING";
		} else if ((tpl.rules as any)?.topLevel) {
			details.code = "TOP_LEVEL_ONLY";
		}
		throw new TemplateInsertError(
			`Cannot insert ${templateId} here.`,
			details
		);
	}

	// Render
	try {
		return tpl.render(params);
	} catch (err: any) {
		throw new TemplateInsertError(
			`Render failed for ${templateId}: ${err?.message ?? String(err)}`,
			{
				code: "RENDER_FAILED",
			}
		);
	}
}

/**
  Convenience for Obsidian commands: inserts at cursor by replacing current line content with line + space + rendered.
  Adjust to fit your preferred insertion semantics.
*/
export function insertTemplateAtCursor<TParams = unknown>(
	templateId: string,
	editor: Editor,
	filePath: string,
	params?: TParams
) {
	const cursor = editor.getCursor();
	const lineText = editor.getLine(cursor.line);
	const content = editor.getValue();

	const ctx: TemplateContext = {
		line: lineText,
		file: content,
		path: filePath,
		editor,
	};

	const rendered = insertTemplate(templateId, ctx, params);

	// Example: append rendered after a space
	const from = { line: cursor.line, ch: 0 };
	const to = { line: cursor.line, ch: lineText.length };
	const next = lineText.length === 0 ? rendered : `${lineText} ${rendered}`;
	editor.replaceRange(next, from, to);
}
