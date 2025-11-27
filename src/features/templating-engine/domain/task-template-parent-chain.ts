import type { Editor } from "obsidian";
import {
	findCurrentLineIndex,
	getEditorLines,
	indentWidth,
	isListLine,
} from "@platform/obsidian/editor/editor-context-utils";

/**
 * Extract a template id from a rendered mark on the given line.
 * Prefers machine-readable data-template-id. Falls back to nothing (we no longer rely on class).
 */
function detectTemplateIdOnLine(line: string): string | undefined {
	const m = line.match(/data-template-id="([^"]+)"/);
	return m ? m[1] : undefined;
}

/**
 * Build an ordered list of ancestor template IDs by scanning upwards using indentation.
 * - Only considers list/task lines as potential ancestors.
 * - A parent must have strictly less indentation than the nearest child selected so far.
 * - Immediate parent is first.
 *
 * Note: Accepts an Obsidian Editor (or compatible subset).
 */
function getAncestorTemplateIdsAtCursor(editor: Editor): string[] {
	const lines = getEditorLines(editor);
	const curIdx = findCurrentLineIndex(editor);
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
 */
export function getArtifactParentChainTemplateIds(ctx: {
	line: string;
	file: unknown;
	editor?: Editor;
}): string[] {
	const editor = ctx.editor;
	if (editor) return getAncestorTemplateIdsAtCursor(editor);

	// Fallback: scan the provided file text
	const lines = Array.isArray(ctx.file)
		? (ctx.file as string[])
		: typeof ctx.file === "string"
		? ctx.file.split(/\r?\n/)
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
			const m = line.match(/data-template-id="([^"]+)"/);
			if (m) ancestors.push(m[1]);
			nextThreshold = iw;
			if (iw === 0) break;
		}
	}
	return ancestors;
}