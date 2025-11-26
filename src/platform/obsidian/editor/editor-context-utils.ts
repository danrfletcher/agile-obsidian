/**
 * Editor-focused utilities.
 *
 * In-app context:
 * - Translates UI events (clicks on marks) into editor positions without moving the cursor.
 *
 * Plugin value:
 * - Enables rich task interactions (assign/change via menus) on Live Preview HTML without disrupting typing.
 */

import { escapeRegExp } from "@utils";
import type { Editor } from "obsidian";
import type { CmEditorViewLike } from "./scroll-preserver";

type EditorPositionLike = { line: number; ch: number };

type EditorWithCoords = Editor & {
	cm?: CmEditorViewLike;
	offsetToPos(offset: number): EditorPositionLike;
};

/**
 * Checks whether a line is an unchecked Markdown task "- [ ] ".
 * @param line A single line of text.
 * @returns true if it matches an unchecked task pattern.
 */
export function isUncheckedTaskLine(line: string): boolean {
	return /^\s*-\s*\[\s*\]\s+/.test(line);
}

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
	const cursor = editor.getCursor();
	let lineNo = typeof cursor.line === "number" ? cursor.line : 0; // fallback

	try {
		const extendedEditor = editor as EditorWithCoords;
		const cm = extendedEditor.cm;

		if (cm?.posAtCoords) {
			const posOrOffset = cm.posAtCoords({
				x: evt.clientX,
				y: evt.clientY,
			});

			if (posOrOffset != null) {
				let pos: EditorPositionLike | null = null;

				if (typeof posOrOffset === "number") {
					pos = extendedEditor.offsetToPos(posOrOffset);
				} else if ("pos" in posOrOffset) {
					pos = extendedEditor.offsetToPos(posOrOffset.pos);
				} else if (
					"line" in posOrOffset &&
					typeof posOrOffset.line === "number" &&
					"ch" in posOrOffset &&
					typeof posOrOffset.ch === "number"
				) {
					pos = {
						line: posOrOffset.line,
						ch: posOrOffset.ch,
					};
				}

				if (pos && typeof pos.line === "number") {
					lineNo = pos.line;
					return lineNo;
				}
			}
		}
	} catch {
		// swallow and fall back to signature search
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
			if (isUncheckedTaskLine(lines[i]) && signature.test(lines[i])) {
				matches.push(i);
			}
		}
		if (matches.length === 1) return matches[0];
	} catch {
		// swallow and return fallback
	}
	return lineNo;
}

/**
 * Determine if a given line is a Markdown task line.
 *
 * Supported:
 * - "- [ ]", "- [x]/[X]", "- [-]", "- [/]", and any other single-char status like "[>]", "[!]", "[?]", etc.
 * - Similarly supports "*", "+", "1." list markers with arbitrary indentation
 * - Treats tabs as 4 spaces
 *
 * Behavior:
 * - Matches both checked and unchecked tasks, including cancelled (-), in-progress (/), and any single status char.
 *
 * @param line A single line of text.
 */
export function isTaskLine(line: string): boolean {
	const expanded = line.replace(/\t/g, "    ");
	// optional indent, list marker (- * + or 1.), space, then [<any single char>], then at least one space or end
	// This generalizes the previous whitelist ( |x|X|-|\/) to any single non-] char, keeping end/space rule
	return /^\s*(?:[-*+]|\d+\.)\s+\[[^\]]\](?:\s+|$)/.test(expanded);
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
	// Count leading spaces; treat tabs as 4 spaces
	let width = 0;
	for (const ch of line) {
		if (ch === " ") width += 1;
		else if (ch === "\t") width += 4;
		else break;
	}
	return width;
}

export function getCheckboxStatusChar(line: string): string | null {
	const m = /^\s*(?:[-*+]|\d+[.)])\s*\[\s*([^\]]?)\s*\]/.exec(line);
	return m ? m[1] ?? "" : null;
}

/**
 * Return all editor lines split by newline.
 * @returns A read-only array of editor lines.
 */
export function getEditorLines(editor: Editor): ReadonlyArray<string> {
	return editor.getValue().split(/\r?\n/);
}

/**
 * Find the current line index using the editor cursor. Fallback to string matching if reference provided.
 * @returns 0-based line index or -1 if not found.
 */
export function findCurrentLineIndex(
	editor: Editor,
	referenceLine?: string
): number {
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
 * Replace the status character inside a Markdown task checkbox token on a list line.
 * Normalizes to no inner spaces: "[x]" or "[-]".
 * Returns the original line if it is not a list task with a checkbox.
 */
export function setCheckboxStatusChar(
	line: string,
	statusChar: "x" | "-"
): string {
	// Match: prefix (indent + list marker + space + "["), any inner content with spaces, closing "]", then the rest.
	const m = line.match(
		/^(\s*(?:[-*+]|\d+[.)])\s*\[)\s*([^\]]?)\s*(\])(.*)$/
	);
	if (!m) return line;
	const prefix = m[1] ?? "";
	const suffixBracket = m[3] ?? "]";
	const tail = m[4] ?? "";
	return `${prefix}${statusChar}${suffixBracket}${tail}`;
}