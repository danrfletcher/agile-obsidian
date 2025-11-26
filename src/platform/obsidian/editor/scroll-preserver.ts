/**
 * Obsidian infra: Scroll capture/restore with CM6 anchor to eliminate drift.
 */
import type { Editor } from "obsidian";

export interface CmDocLike {
	lineAt(pos: number): { from: number; to: number; number: number };
	line(line: number): { from: number; to: number; number: number };
	readonly lines: number;
}

export interface CmViewportLike {
	from: number;
	to: number;
}

export interface CmBlockInfoLike {
	top: number;
}

export interface CmEditorViewLike {
	state?: {
		doc: CmDocLike;
		selection?: {
			main: { from: number; to: number };
		};
	};
	viewport?: CmViewportLike;
	scrollDOM?: HTMLElement;
	contentDOM?: HTMLElement;
	lineBlockAt(pos: number): CmBlockInfoLike;
	posAtCoords?(
		coords: { x: number; y: number }
	): number | { pos: number } | { line: number; ch: number } | null;
}

export function getEditorScroller(editor: Editor): HTMLElement | null {
	try {
		const editorWithCm = editor as Editor & { cm?: CmEditorViewLike };
		const cm = editorWithCm.cm;
		if (cm?.scrollDOM instanceof HTMLElement) {
			return cm.scrollDOM;
		}
	} catch {
		/* ignore and fall through to DOM query */
	}
	try {
		const active = document.querySelector(
			".workspace-leaf.mod-active .cm-scroller"
		);
		if (active instanceof HTMLElement) return active;

		const anyScroller = document.querySelector(".cm-scroller");
		return anyScroller instanceof HTMLElement ? anyScroller : null;
	} catch {
		return null;
	}
}

export type ScrollSnapshot = {
	el: HTMLElement | null;
	top: number;
	left: number;
	// Optional CM6-based anchor info
	view?: CmEditorViewLike;
	anchorLine?: number;
	anchorTop?: number;
	scrollTop?: number;
};

export function captureEditorScroll(editor: Editor): ScrollSnapshot {
	const el = getEditorScroller(editor);
	const snap: ScrollSnapshot = {
		el,
		top: el?.scrollTop ?? 0,
		left: el?.scrollLeft ?? 0,
	};

	// Try to anchor to the first visible line using CM6 internals.
	try {
		const editorWithCm = editor as Editor & { cm?: CmEditorViewLike };
		const view = editorWithCm.cm;
		if (
			view?.state?.doc &&
			view.viewport &&
			typeof view.viewport.from === "number"
		) {
			const doc = view.state.doc;
			const firstVisibleLineNo0 =
				doc.lineAt(view.viewport.from).number - 1;
			const firstLine = doc.line(firstVisibleLineNo0 + 1);
			const block = view.lineBlockAt(firstLine.from);
			if (block && typeof block.top === "number") {
				snap.view = view;
				snap.anchorLine = firstVisibleLineNo0;
				snap.anchorTop = block.top;
				snap.scrollTop = el?.scrollTop ?? 0;
			}
		}
	} catch {
		/* soft-fail */
	}

	return snap;
}

export function restoreEditorScrollLater(snap: ScrollSnapshot): void {
	const tryRestoreWithAnchor = () => {
		try {
			const {
				el,
				view,
				anchorLine,
				anchorTop,
				scrollTop,
				top,
				left,
			} = snap;

			if (!el || !view || anchorLine == null || anchorTop == null) {
				if (el) {
					el.scrollTop = top;
					el.scrollLeft = left;
				}
				return;
			}

			const doc = view.state?.doc;
			if (!doc) {
				el.scrollTop = top;
				el.scrollLeft = left;
				return;
			}

			const clampedLine0 = Math.min(
				Math.max(0, anchorLine),
				doc.lines - 1
			);
			const lineInfo = doc.line(clampedLine0 + 1);
			const blockNow = view.lineBlockAt(lineInfo.from);
			if (!blockNow || typeof blockNow.top !== "number") {
				el.scrollTop = top;
				el.scrollLeft = left;
				return;
			}

			const delta = blockNow.top - anchorTop;
			const targetScrollTop = (scrollTop ?? top) + delta;
			el.scrollTop = targetScrollTop;
			el.scrollLeft = left;
		} catch {
			if (snap.el) {
				try {
					snap.el.scrollTop = snap.top;
					snap.el.scrollLeft = snap.left;
				} catch {
					// ignore
				}
			}
		}
	};

	requestAnimationFrame(() => {
		tryRestoreWithAnchor();
		requestAnimationFrame(() => {
			tryRestoreWithAnchor();
		});
	});
}