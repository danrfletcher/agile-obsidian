/**
 * Utilities for gathering context around the current cursor in an Obsidian MarkdownView.
 */
import { App, MarkdownView } from "obsidian";

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

function resolveContentRoot(
	view: MarkdownView | undefined
): HTMLElement | null {
	if (!view) return null;
	const cmContent =
		(view as any)?.editor?.cm?.contentDOM ||
		view.containerEl.querySelector(".cm-content");
	return (cmContent as HTMLElement) ?? null;
}

export async function getCursorContext(
	app: App,
	viewParam?: MarkdownView,
	editor?: any
): Promise<CursorContext> {
	const view =
		viewParam ??
		(app.workspace.getActiveViewOfType(MarkdownView) as
			| MarkdownView
			| undefined);
	const ctx: Partial<CursorContext> = {};
	ctx.filePath = (view?.file?.path as string) ?? "";

	let content: string | undefined = undefined;
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
			} else if (editor.cm && editor.cm.state) {
				const sel = (editor.cm as any).state.selection.main;
				lineNum =
					(editor.cm as any).state.doc.lineAt(sel.from).number - 1;
				col =
					sel.from -
					(editor.cm as any).state.doc.lineAt(sel.from).from;
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
		) as HTMLElement[];
		for (const w of wrappers) {
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
