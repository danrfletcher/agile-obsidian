/**
 * Obsidian infra: Scroll capture/restore with CM6 anchor to eliminate drift.
 */
import type { Editor } from "obsidian";

export function getEditorScroller(editor: Editor): HTMLElement | null {
	try {
		const cm: any = (editor as any).cm;
		if (cm?.scrollDOM) return cm.scrollDOM as HTMLElement;
	} catch {
		/* ignore */
	}
	try {
		const active = document.querySelector(
			".workspace-leaf.mod-active .cm-scroller"
		) as HTMLElement | null;
		if (active) return active;
		return document.querySelector(".cm-scroller") as HTMLElement | null;
	} catch {
		return null;
	}
}

export type ScrollSnapshot = {
	el: HTMLElement | null;
	top: number;
	left: number;
	// Optional CM6-based anchor info
	view?: any;
	anchorLine?: number;
	anchorTop?: number;
	scrollTop?: number;
};

export function captureEditorScroll(editor: Editor): ScrollSnapshot {
	const el = getEditorScroller(editor);
	const snap: ScrollSnapshot = {
		el,
		top: el ? el.scrollTop : 0,
		left: el ? el.scrollLeft : 0,
	};

	// Try to anchor to the first visible line using CM6 internals.
	try {
		const view: any = (editor as any).cm;
		if (
			view?.state &&
			view?.viewport &&
			typeof view.viewport.from === "number"
		) {
			const doc = view.state.doc;
			const firstVisibleLineNo0 =
				doc.lineAt(view.viewport.from).number - 1;
			const block = view.lineBlockAt(
				doc.line(firstVisibleLineNo0 + 1).from
			);
			if (block && typeof block.top === "number") {
				snap.view = view;
				snap.anchorLine = firstVisibleLineNo0;
				snap.anchorTop = block.top;
				snap.scrollTop = el ? el.scrollTop : 0;
			}
		}
	} catch {
		/* soft-fail */
	}

	return snap;
}

export function restoreEditorScrollLater(snap: ScrollSnapshot) {
	const tryRestoreWithAnchor = () => {
		try {
			if (
				!snap.el ||
				!snap.view ||
				snap.anchorLine == null ||
				snap.anchorTop == null ||
				snap.scrollTop == null
			) {
				if (snap.el) {
					snap.el.scrollTop = snap.top;
					snap.el.scrollLeft = snap.left;
				}
				return;
			}
			const view = snap.view;
			const el = snap.el;
			const doc = view.state?.doc;
			if (!doc) {
				el.scrollTop = snap.top;
				el.scrollLeft = snap.left;
				return;
			}
			const lineNo0 = Math.min(
				Math.max(0, snap.anchorLine),
				doc.lines - 1
			);
			const blockNow = view.lineBlockAt(doc.line(lineNo0 + 1).from);
			if (!blockNow || typeof blockNow.top !== "number") {
				el.scrollTop = snap.top;
				el.scrollLeft = snap.left;
				return;
			}
			const delta = blockNow.top - snap.anchorTop;
			const targetScrollTop = (snap.scrollTop ?? snap.top) + delta;
			el.scrollTop = targetScrollTop;
			el.scrollLeft = snap.left;
		} catch {
			if (snap.el) {
				try {
					snap.el.scrollTop = snap.top;
					snap.el.scrollLeft = snap.left;
				} catch {}
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
