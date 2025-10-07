/**
 * Obsidian infra: Editor-based mutations with selection + scroll stability.
 */
import type { Editor } from "obsidian";
import { getCheckboxStatusChar } from "@platform/obsidian";
import { setCheckboxStatusChar } from "../../domain/task-status-utils";
import {
	DEFAULT_STATUS_SEQUENCE,
	type StatusChar,
	getNextStatusChar,
} from "../../domain/task-status-sequence";
import {
	captureEditorScroll,
	restoreEditorScrollLater,
} from "./scroll-preserver";

/**
 * Advance the task status at a specific editor line according to the provided sequence.
 * Preserves editor scroll and selection on that line.
 */
export function advanceTaskStatusAtEditorLine(
	editor: Editor,
	line0: number,
	sequence: ReadonlyArray<StatusChar> = DEFAULT_STATUS_SEQUENCE
): { from: string | null; to: StatusChar | null; didChange: boolean } {
	const orig = editor.getLine(line0) ?? "";
	const from = getCheckboxStatusChar(orig);
	if (from == null) return { from, to: null, didChange: false };
	const to = getNextStatusChar(from, sequence);
	const updated = setCheckboxStatusChar(orig, to);
	if (updated === orig) return { from, to, didChange: false };

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
		updated,
		{ line: line0, ch: 0 },
		{ line: line0, ch: orig.length }
	);

	if (selectionOnLine) {
		try {
			const newLen = updated.length;
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
	return { from, to, didChange: true };
}

/**
 * Set the task status at a specific editor line to an explicit target char.
 * Preserves editor scroll and selection on that line.
 */
export function setTaskStatusAtEditorLine(
	editor: Editor,
	line0: number,
	to: StatusChar
): { from: string | null; to: StatusChar; didChange: boolean } {
	const orig = editor.getLine(line0) ?? "";
	const from = getCheckboxStatusChar(orig);
	if (from == null) return { from, to, didChange: false };
	const updated = setCheckboxStatusChar(orig, to);
	if (updated === orig) return { from, to, didChange: false };

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
		updated,
		{ line: line0, ch: 0 },
		{ line: line0, ch: orig.length }
	);

	if (selectionOnLine) {
		try {
			const newLen = updated.length;
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
	return { from, to, didChange: true };
}

/**
 * Compute a position from a mouse/keyboard/pointer event relative to the editor.
 */
export function findPosFromEvent(
	editor: Editor,
	evt: MouseEvent | KeyboardEvent | PointerEvent
): { line: number; ch: number } | null {
	let x: number | null = null;
	let y: number | null = null;

	if ("clientX" in evt && typeof (evt as MouseEvent).clientX === "number") {
		x = (evt as MouseEvent).clientX;
		y = (evt as MouseEvent).clientY;
	} else {
		const target = evt.target as HTMLElement | null;
		if (target && target.getBoundingClientRect) {
			const rect = target.getBoundingClientRect();
			x = rect.left + rect.width / 2;
			y = rect.top + rect.height / 2;
		}
	}

	try {
		const cm: any = (editor as any).cm;
		if (
			cm &&
			typeof cm.posAtCoords === "function" &&
			x != null &&
			y != null
		) {
			const posOrOffset = cm.posAtCoords({ x, y });
			let pos: any = null;
			if (posOrOffset != null) {
				pos =
					typeof posOrOffset === "number"
						? editor.offsetToPos(posOrOffset)
						: "pos" in posOrOffset
						? editor.offsetToPos((posOrOffset as any).pos)
						: posOrOffset;
			}
			if (
				pos &&
				typeof pos.line === "number" &&
				typeof pos.ch === "number"
			) {
				return { line: pos.line, ch: pos.ch };
			}
		}
	} catch {
		/* ignore */
	}
	try {
		const cur = editor.getCursor();
		return { line: (cur as any).line ?? 0, ch: (cur as any).ch ?? 0 };
	} catch {
		return null;
	}
}

/**
 * Legacy helper: line number from event.
 */
export function findLineFromEvent(
	editor: Editor,
	evt: MouseEvent | KeyboardEvent
): number {
	const p = findPosFromEvent(editor, evt);
	return p?.line ?? (editor as any).getCursor().line ?? 0;
}

/**
 * Determine if a position is within the checkbox "[ ]" token of a task line.
 * We locate "[...]" after the list marker (e.g., "- " or "1. ").
 */
export function isPosOnCheckboxToken(lineText: string, ch: number): boolean {
	if (getCheckboxStatusChar(lineText) == null) return false;

	const m = lineText.match(/^\s*(?:[-*+]|\d+[.)])\s*/);
	const markerEnd = m ? m[0].length : 0;
	const openIdx = lineText.indexOf("[", markerEnd);
	if (openIdx < 0) return false;
	const closeIdx = lineText.indexOf("]", openIdx);
	if (closeIdx < 0) return false;

	return ch >= openIdx && ch <= closeIdx + 1;
}
