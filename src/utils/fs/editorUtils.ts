/**
 * Editor-focused utilities.
 *
 * In-app context:
 * - Translates UI events (clicks on marks) into editor positions without moving the cursor.
 *
 * Plugin value:
 * - Enables rich task interactions (assign/change via menus) on Live Preview HTML without disrupting typing.
 */

import type { Editor } from "obsidian";
import {
	escapeRegExp,
	isUncheckedTaskLine,
} from "src/utils/commands/commandUtils";

/**
 * Determine the target line number in the editor corresponding to a click on a <mark>,
 * using coordinate-to-position mapping when available, and falling back to searching for a
 * unique line signature that contains the alias.
 *
 * In-app use:
 * - Used by the mark context menu to find which task line to operate on when a mark is clicked.
 *
 * Plugin value:
 * - Provides robust line resolution across different editor states, minimizing cursor movement.
 *
 * @param editor The active editor instance.
 * @param evt The mouse event from the click.
 * @param alias The alias (from the clicked mark's class, e.g., active-jane-doe).
 * @returns The 0-based line number to update.
 */
export function findTargetLineFromClick(
	editor: Editor,
	evt: MouseEvent,
	alias: string
): number {
	let lineNo = editor.getCursor().line; // fallback
	try {
		const cm: any = (editor as any).cm;
		if (cm && typeof cm.posAtCoords === "function") {
			const posOrOffset = cm.posAtCoords({
				x: evt.clientX,
				y: evt.clientY,
			});
			if (posOrOffset != null) {
				const pos =
					typeof posOrOffset === "number"
						? editor.offsetToPos(posOrOffset)
						: "pos" in posOrOffset
						? editor.offsetToPos((posOrOffset as any).pos)
						: posOrOffset;
				if (pos && typeof (pos as any).line === "number") {
					lineNo = (pos as any).line;
					return lineNo;
				}
			}
		}
	} catch (err) {
		void err;
	}
	// Fallback: find a unique line containing this alias class
	try {
		const signature = new RegExp(
			`\\bclass="(?:active|inactive)-${escapeRegExp(alias)}"\\b`,
			"i"
		);
		const lines = editor.getValue().split("\n");
		const matches: number[] = [];
		for (let i = 0; i < lines.length; i++) {
			if (isUncheckedTaskLine(lines[i]) && signature.test(lines[i]))
				matches.push(i);
		}
		if (matches.length === 1) return matches[0];
	} catch (err) {
		void err;
	}
	return lineNo;
}

/**
 * Determine if a given line is a Markdown task line.
 *
 * Supported:
 * - "- [ ]", "- [x]", "* [ ]", "+ [ ]", "1. [ ]" with arbitrary indentation
 * - Treats tabs as 4 spaces
 *
 * Note:
 * - This is broader than isUncheckedTaskLine; it matches both checked and unchecked tasks.
 */
export function isTaskLine(line: string): boolean {
  const expanded = line.replace(/\t/g, "    ");
  // optional indent, list marker (- * + or 1.), space, then [ ] or [x]/[X], then at least one space or end
  return /^\s*(?:[-*+]|\d+\.)\s+\[(?: |x|X)\](?:\s+|$)/.test(expanded);
}

/**
 * Determine if a line is a Markdown list item (bulleted or ordered), regardless of checkbox.
 */
export function isListLine(line: string): boolean {
  const expanded = line.replace(/\t/g, "    ");
  return /^\s*(?:[-*+]|\d+\.)\s+/.test(expanded);
}

/**
 * Compute indentation width (spaces) at the beginning of a line.
 * Tabs are expanded to 4 spaces.
 */
export function indentWidth(line: string): number {
  const expanded = line.replace(/\t/g, "    ");
  const m = expanded.match(/^\s*/);
  return m ? m[0].length : 0;
}

/**
 * Return all editor lines split by newline.
 */
export function getEditorLines(editor: Editor): string[] {
  return editor.getValue().split(/\r?\n/);
}

/**
 * Find the current line index using the editor cursor. Fallback to string matching if reference provided.
 */
export function findCurrentLineIndex(editor: Editor, referenceLine?: string): number {
  const lineFromCursor = editor.getCursor().line;
  if (Number.isInteger(lineFromCursor)) return lineFromCursor;

  if (referenceLine) {
    const lines = getEditorLines(editor);
    let idx = lines.findIndex((l) => l === referenceLine);
    if (idx !== -1) return idx;
    const norm = referenceLine.replace(/\s+$/, "");
    idx = lines.findIndex((l) => l.replace(/\s+$/, "") === norm);
    return idx;
  }

  return -1;
}

/**
 * Extract a template id from a rendered mark on the given line.
 * Prefers machine-readable data-template-id. Falls back to nothing (we no longer rely on class).
 */
export function detectTemplateIdOnLine(line: string): string | undefined {
  const m = line.match(/data-template-id="([^"]+)"/);
  return m ? m[1] : undefined;
}

/**
 * Build an ordered list of ancestor template IDs by scanning upwards using indentation.
 * - Only considers list/task lines as potential ancestors.
 * - A parent must have strictly less indentation than the nearest child selected so far.
 * - Immediate parent is first.
 */
export function getAncestorTemplateIdsAtCursor(editor: Editor): string[] {
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
export function getParentChainTemplateIds(ctx: { line: string; file: unknown; editor?: Editor }): string[] {
  const editor = ctx.editor;
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
      const m = line.match(/data-template-id="([^"]+)"/);
      if (m) ancestors.push(m[1]);
      nextThreshold = iw;
      if (iw === 0) break;
    }
  }
  return ancestors;
}