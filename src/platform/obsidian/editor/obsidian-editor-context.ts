/**
 * Utilities for gathering context around the current cursor in an Obsidian MarkdownView.
 */
import { MarkdownView, type App, type Editor } from "obsidian";
import type { CmEditorViewLike } from "./scroll-preserver";

export type CursorContext = {
	filePath: string;
	fileContent?: string;
	lineNumber: number; // 0-based
	column: number; // 0-based
	lineText: string;
	prevLineText?: string;
	nextLineText?: string;
	lineIsTask?: boolean;
	wrapperEl?: HTMLElement | null;
	wrapperTemplateKey?: string | null;
	wrapperMarkId?: string | null;
	wrapperOrderTag?: string | null;
};

/**
 * Intersection-based helper type that augments MarkdownView with a richer
 * editor shape (including an optional CM view) without "extending" it.
 *
 * Using a type alias with "&" avoids the "incorrectly extends" error that
 * arises when trying to re-declare the "editor" property with a different
 * type/optionality than the core MarkdownView interface.
 */
type MarkdownViewWithEditor = MarkdownView & {
	editor?: Editor & { cm?: CmEditorViewLike };
};

type EditorWithCm = Editor & {
	cm?: CmEditorViewLike;
};

function resolveContentRoot(
	view: MarkdownView | null | undefined
): HTMLElement | null {
	if (!view) return null;

	const viewWithEditor = view as MarkdownViewWithEditor;
	const cmContent = viewWithEditor.editor?.cm?.contentDOM;
	if (cmContent instanceof HTMLElement) {
		return cmContent;
	}

	const fallback = view.containerEl.querySelector(".cm-content");
	return fallback instanceof HTMLElement ? fallback : null;
}

export async function getCursorContext(
	app: App,
	viewParam?: MarkdownView,
	editor?: Editor
): Promise<CursorContext> {
	const view =
		viewParam ?? app.workspace.getActiveViewOfType(MarkdownView);

	const ctx: Partial<CursorContext> = {};
	ctx.filePath = (view?.file?.path as string) ?? "";

	let content: string | undefined;
	if (editor && typeof editor.getValue === "function") {
		try {
			content = editor.getValue();
		} catch {
			content = undefined;
		}
	}
	if (content == null && view?.file) {
		try {
			content = await app.vault.read(view.file);
		} catch {
			content = undefined;
		}
	}
	ctx.fileContent = content;

	let lineNum = 0;
	let col = 0;
	if (editor) {
		try {
			if (typeof editor.getCursor === "function") {
				const c = editor.getCursor();
				lineNum = typeof c.line === "number" ? c.line : 0;
				col = typeof c.ch === "number" ? c.ch : 0;
			} else {
				const editorWithCm = editor as EditorWithCm;
				const cm = editorWithCm.cm;
				const selection = cm?.state?.selection?.main;
				const doc = cm?.state?.doc;
				if (selection && doc) {
					const lineAt = doc.lineAt(selection.from);
					lineNum = lineAt.number - 1;
					col = selection.from - lineAt.from;
				}
			}
		} catch {
			lineNum = 0;
			col = 0;
		}
	}
	ctx.lineNumber = lineNum;
	ctx.column = col;

	const lines = (content ?? "").split(/\r?\n/);
	ctx.lineText = lines[lineNum] ?? "";
	ctx.prevLineText = lines[lineNum - 1] ?? undefined;
	ctx.nextLineText = lines[lineNum + 1] ?? undefined;
	ctx.lineIsTask = /^\s*[-*+]\s*\[.?\]/.test(ctx.lineText || "");

	// Try to find a wrapper element on this or nearby line in the rendered view
	const contentRoot = resolveContentRoot(view);
	let foundWrapper: HTMLElement | null = null;
	if (contentRoot) {
		const wrappers = Array.from(
			contentRoot.querySelectorAll("[data-template-wrapper]")
		);
		for (const w of wrappers as HTMLElement[]) {
			// Heuristic: match by text inclusion
			const txt = (w.textContent ?? "").trim();
			if (
				txt.length &&
				((ctx.lineText && txt.includes((ctx.lineText || "").trim())) ||
					(ctx.prevLineText &&
						txt.includes((ctx.prevLineText || "").trim())))
			) {
				foundWrapper = w;
				break;
			}
		}
	}
	ctx.wrapperEl = foundWrapper;
	if (foundWrapper) {
		ctx.wrapperTemplateKey = foundWrapper.getAttribute("data-template-key");
		ctx.wrapperMarkId = foundWrapper.getAttribute("data-template-mark-id");
		// IMPORTANT: orderTag lives on the wrapper (not on the mark)
		ctx.wrapperOrderTag = foundWrapper.getAttribute("data-order-tag");
	}

	return ctx as CursorContext;
}