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
import { escapeRegExp, isUncheckedTaskLine } from "../utils/commands/commandUtils";

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
export function findTargetLineFromClick(editor: Editor, evt: MouseEvent, alias: string): number {
	let lineNo = editor.getCursor().line; // fallback
	try {
		const cm: any = (editor as any).cm;
		if (cm && typeof cm.posAtCoords === "function") {
			const posOrOffset = cm.posAtCoords({ x: evt.clientX, y: evt.clientY });
			if (posOrOffset != null) {
				const pos =
					typeof posOrOffset === "number"
						? editor.offsetToPos(posOrOffset)
						: ("pos" in posOrOffset ? editor.offsetToPos((posOrOffset as any).pos) : posOrOffset);
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
		const signature = new RegExp(`\\bclass="(?:active|inactive)-${escapeRegExp(alias)}"\\b`, "i");
		const lines = editor.getValue().split("\n");
		const matches: number[] = [];
		for (let i = 0; i < lines.length; i++) {
			if (isUncheckedTaskLine(lines[i]) && signature.test(lines[i])) matches.push(i);
		}
		if (matches.length === 1) return matches[0];
	} catch (err) {
		void err;
	}
	return lineNo;
}
