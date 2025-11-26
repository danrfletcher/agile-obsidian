/**
 * Generic editor mutations with scroll and selection preservation.
 * Feature modules pass a pure line transformer function.
 */
import type { Editor } from "obsidian";
import {
	captureEditorScroll,
	restoreEditorScrollLater,
} from "./scroll-preserver";

interface EditorCursorLike {
	line: number;
	ch: number;
}

/**
 * Helper type that augments the Obsidian Editor with selection-related APIs.
 *
 * We use an intersection type instead of "extends" so we can:
 * - Keep getCursor/setSelection/setCursor as optional in this helper shape.
 * - Widen getCursor's parameter union to match Obsidian's ("from" | "to" | "head" | "anchor").
 *
 * This avoids TypeScript compatibility errors with the core Editor interface
 * while still letting us safely probe for and use these methods at runtime.
 */
type EditorWithSelection = Editor & {
	getCursor?: (
		which?: "from" | "to" | "head" | "anchor"
	) => EditorCursorLike;
	setSelection?(
		anchor: EditorCursorLike,
		head: EditorCursorLike
	): void;
	setCursor?(pos: EditorCursorLike): void;
};

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

	const editorWithSelection = editor as EditorWithSelection;
	const fromSel =
		typeof editorWithSelection.getCursor === "function"
			? editorWithSelection.getCursor("from")
			: undefined;
	const toSel =
		typeof editorWithSelection.getCursor === "function"
			? editorWithSelection.getCursor("to")
			: undefined;

	const hasCursorAPI =
		!!fromSel &&
		!!toSel &&
		typeof fromSel.line === "number" &&
		typeof fromSel.ch === "number" &&
		typeof toSel.line === "number" &&
		typeof toSel.ch === "number";

	const selectionOnLine =
		hasCursorAPI &&
		(fromSel!.line === line0 || toSel!.line === line0) &&
		fromSel!.line === toSel!.line;

	editor.replaceRange(
		after,
		{ line: line0, ch: 0 },
		{ line: line0, ch: before.length }
	);

	if (selectionOnLine && fromSel && toSel) {
		try {
			const newLen = after.length;
			const newFromCh = Math.max(
				0,
				Math.min(newLen, fromSel.ch)
			);
			const newToCh = Math.max(0, Math.min(newLen, toSel.ch));

			if (typeof editorWithSelection.setSelection === "function") {
				editorWithSelection.setSelection(
					{ line: line0, ch: newFromCh },
					{ line: line0, ch: newToCh }
				);
			} else if (
				newFromCh === newToCh &&
				typeof editorWithSelection.setCursor === "function"
			) {
				editorWithSelection.setCursor({
					line: line0,
					ch: newFromCh,
				});
			}
		} catch {
			// best-effort; ignore selection errors
		}
	}

	restoreEditorScrollLater(scroll);
	return { before, after, didChange: true };
}