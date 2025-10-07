/**
 * Generic editor mutations with scroll and selection preservation.
 * Feature modules pass a pure line transformer function.
 */
import type { Editor } from "obsidian";
import {
	captureEditorScroll,
	restoreEditorScrollLater,
} from "./scroll-preserver";

/**
 * Apply a pure transformation to a single editor line.
 * Preserves:
 * - Scroll position (anchor-based)
 * - Selection on that line (best effort)
 */
export function applyLineTransform(
	editor: Editor,
	line0: number,
	transform: (origLine: string) => string
): { before: string; after: string; didChange: boolean } {
	const before = editor.getLine(line0) ?? "";
	const after = transform(before);

	if (after === before) {
		return { before, after, didChange: false };
	}

	const scroll = captureEditorScroll(editor);

	let fromSel: any = (editor as any).getCursor?.("from");
	let toSel: any = (editor as any).getCursor?.("to");
	const hasCursorAPI =
		fromSel &&
		toSel &&
		typeof fromSel.line === "number" &&
		typeof fromSel.ch === "number" &&
		typeof toSel.line === "number" &&
		typeof toSel.ch === "number";
	const selectionOnLine =
		hasCursorAPI &&
		(fromSel.line === line0 || toSel.line === line0) &&
		fromSel.line === toSel.line;

	editor.replaceRange(
		after,
		{ line: line0, ch: 0 },
		{ line: line0, ch: before.length }
	);

	if (selectionOnLine) {
		try {
			const newLen = after.length;
			const newFromCh = Math.max(0, Math.min(newLen, fromSel.ch));
			const newToCh = Math.max(0, Math.min(newLen, toSel.ch));
			if (typeof (editor as any).setSelection === "function") {
				(editor as any).setSelection(
					{ line: line0, ch: newFromCh },
					{ line: line0, ch: newToCh }
				);
			} else if (
				newFromCh === newToCh &&
				typeof (editor as any).setCursor === "function"
			) {
				(editor as any).setCursor({ line: line0, ch: newFromCh });
			}
		} catch {}
	}

	restoreEditorScrollLater(scroll);
	return { before, after, didChange: true };
}
