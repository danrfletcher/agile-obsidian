import {
	findCurrentLineIndex,
	getEditorLines,
	indentWidth,
	isListLine,
} from "@platform/obsidian/editor/editor-context-utils";
import type { TemplateContext } from "./types";

/**
 * Extract a template id from a rendered mark on the given line.
 * Prefer data-template-key (actual wrapper attribute). Fallback to data-template-id for backward-compat.
 */
function detectTemplateIdOnLine(line: string): string | undefined {
	const mKey = line.match(/data-template-key="([^"]+)"/);
	if (mKey) return mKey[1];
	const mId = line.match(/data-template-id="([^"]+)"/);
	return mId ? mId[1] : undefined;
}

/**
 * Build an ordered list of ancestor template IDs by scanning upwards using indentation.
 * - Only considers list/task lines as potential ancestors.
 * - A parent must have strictly less indentation than the nearest child selected so far.
 * - Immediate parent is first.
 *
 * Note: Accepts a minimal editor shape (typed as any) to avoid direct Obsidian Editor imports.
 */
function getAncestorTemplateIdsAtCursor(editor: any): string[] {
	const lines = getEditorLines(editor as any);
	const curIdx = findCurrentLineIndex(editor as any);
	if (curIdx < 0 || curIdx >= lines.length) return [];

	const curLine = lines[curIdx];
	if (!isListLine(curLine)) return [];

	const curIndent = indentWidth(curLine);
	const ancestors: string[] = [];
	let nextThreshold = Number.POSITIVE_INFINITY;

	for (let i = curIdx - 1; i >= 0; i--) {
		const line = lines[i];
		if (!isListLine(line)) continue;

		const iw = indentWidth(line);
		if (iw < Math.min(nextThreshold, curIndent)) {
			const id = detectTemplateIdOnLine(line);
			if (id) ancestors.push(id);
			nextThreshold = iw;
			if (iw === 0) break;
		}
	}

	return ancestors;
}

/**
 * Provide a context-compatible function to fetch parent chain for the current ctx.
 * If ctx.editor exists, use it. Otherwise, attempt a best-effort using ctx.file text.
 *
 * Signature matches isAllowedInContext's expected callback: (ctx: TemplateContext) => string[]
 */
export function getArtifactParentChainTemplateIds(
	ctx: TemplateContext
): string[] {
	const editor = ctx.editor as any | undefined;
	if (editor) return getAncestorTemplateIdsAtCursor(editor);

	// Fallback: scan the provided file text
	const lines = Array.isArray(ctx.file)
		? (ctx.file as string[])
		: typeof ctx.file === "string"
		? (ctx.file as string).split(/\r?\n/)
		: [];

	if (lines.length === 0) return [];

	let idx = lines.findIndex((l) => l === ctx.line);
	if (idx === -1) {
		const norm = ctx.line.replace(/\s+$/, "");
		idx = lines.findIndex((l) => l.replace(/\s+$/, "") === norm);
	}
	if (idx === -1) return [];

	const curLine = lines[idx];
	if (!isListLine(curLine)) return [];

	const curIndent = indentWidth(curLine);
	const ancestors: string[] = [];
	let nextThreshold = Number.POSITIVE_INFINITY;

	for (let i = idx - 1; i >= 0; i--) {
		const line = lines[i];
		if (!isListLine(line)) continue;

		const iw = indentWidth(line);
		if (iw < Math.min(nextThreshold, curIndent)) {
			const id = detectTemplateIdOnLine(line);
			if (id) ancestors.push(id);
			nextThreshold = iw;
			if (iw === 0) break;
		}
	}
	return ancestors;
}
