/**
 * Editor/UI interaction helpers (hit testing, token ranges).
 */
import type { Editor } from "obsidian";
import type { CmEditorViewLike } from "./scroll-preserver";

export interface EditorOffsetPosition {
	line: number;
	ch: number;
}

type PosFromCoords =
	| number
	| { pos: number }
	| { line: number; ch: number };

type EditorWithCoords = Editor & {
	cm?: CmEditorViewLike;
	offsetToPos(offset: number): EditorOffsetPosition;
};

/**
 * Map a pointer/mouse/keyboard event to an editor position.
 * Falls back to current cursor when posAtCoords is unavailable.
 */
export function findPosFromEvent(
	editor: Editor,
	evt: MouseEvent | KeyboardEvent | PointerEvent
): EditorOffsetPosition | null {
	let x: number | null = null;
	let y: number | null = null;

	if ("clientX" in evt && typeof evt.clientX === "number") {
		x = evt.clientX;
		y = evt.clientY;
	} else {
		const target = evt.target as HTMLElement | null;
		if (target && target.getBoundingClientRect) {
			const rect = target.getBoundingClientRect();
			x = rect.left + rect.width / 2;
			y = rect.top + rect.height / 2;
		}
	}

	try {
		const extendedEditor = editor as EditorWithCoords;
		const cm = extendedEditor.cm;

		if (cm && cm.posAtCoords && x != null && y != null) {
			const posOrOffset = cm.posAtCoords({ x, y }) as PosFromCoords | null;
			let pos: EditorOffsetPosition | null = null;

			if (posOrOffset != null) {
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
			}

			if (pos) {
				return pos;
			}
		}
	} catch {
		/* ignore */
	}

	try {
		const cur = editor.getCursor();
		const line =
			typeof cur.line === "number" && Number.isFinite(cur.line)
				? cur.line
				: 0;
		const ch =
			typeof cur.ch === "number" && Number.isFinite(cur.ch)
				? cur.ch
				: 0;
		return { line, ch };
	} catch {
		return null;
	}
}

/** Convenience: derive line number from an event (fallback to cursor). */
export function findLineFromEvent(
	editor: Editor,
	evt: MouseEvent | KeyboardEvent
): number {
	const p = findPosFromEvent(editor, evt);
	if (p && typeof p.line === "number") {
		return p.line;
	}
	const cur = editor.getCursor();
	return typeof cur.line === "number" ? cur.line : 0;
}

/**
 * Compute the character range [fromCh, toCh] where:
 * - fromCh is the index of the opening '[' of the checkbox token
 * - toCh is ONE-PAST the index of the closing ']' (i.e., right boundary inclusive if you compare with <=)
 *
 * Returns null if the line isn't a list task with a checkbox marker.
 */
export function computeCheckboxTokenRange(
	lineText: string
): { fromCh: number; toCh: number } | null {
	// Find the list marker ("- ", "* ", "+ ", "1. ", "1) ") with optional indentation
	const m = lineText.match(/^\s*(?:[-*+]|\d+[.)])\s*/);
	const markerEnd = m ? m[0].length : 0;

	const openIdx = lineText.indexOf("[", markerEnd);
	if (openIdx < 0) return null;
	const closeIdx = lineText.indexOf("]", openIdx);
	if (closeIdx < 0) return null;

	// Return half-open style bounds but with toCh being one-past the closing bracket
	// This allows treating positions exactly at close+1 as still "on the checkbox".
	return { fromCh: openIdx, toCh: closeIdx + 1 };
}

/**
 * True if ch falls on the checkbox token (including immediately after the closing bracket).
 * This mirrors the previously working behavior, enabling reliable pointerdown suppression.
 */
export function isPosOnCheckboxToken(lineText: string, ch: number): boolean {
	const r = computeCheckboxTokenRange(lineText);
	if (!r) return false;
	// Include the right boundary so clicks landing at the char immediately after ']' are considered on the checkbox.
	return ch >= r.fromCh && ch <= r.toCh;
}