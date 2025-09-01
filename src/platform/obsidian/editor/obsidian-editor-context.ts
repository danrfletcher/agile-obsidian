/**
 * Utilities for gathering context around the current cursor in an Obsidian MarkdownView.
 * Provides a snapshot with file path, current line/column, surrounding lines, and optional
 * references to rendered wrapper elements in Live Preview (when detectable).
 *
 * Note:
 * - Uses best-effort fallbacks where editor/view internals differ.
 * - Designed for read-only context; callers should not mutate returned objects.
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
	// Prefer the actual CodeMirror 6 content surface
	const cmContent =
		(view as any)?.editor?.cm?.contentDOM ||
		view.containerEl.querySelector(".cm-content");
	return (cmContent as HTMLElement) ?? null;
}

/**
 * Capture a snapshot of the current cursor context from the given view/editor,
 * including surrounding text lines and some Live Preview wrapper hints when available.
 *
 * @param app Obsidian App
 * @param viewParam Optional view; if omitted, the active MarkdownView is used.
 * @param editor Optional editor (for environments where view.editor may differ).
 * @returns A CursorContext describing the current position and related metadata.
 */
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

	// Cursor position
	let lineNum = 0;
	let col = 0;
	if (editor) {
		// try common editor APIs
		if (typeof editor.getCursor === "function") {
			const c = editor.getCursor();
			lineNum = typeof c.line === "number" ? c.line : 0;
			col =
				typeof c.ch === "number"
					? c.ch
					: typeof c.ch === "number"
					? c.ch
					: 0;
		} else if (editor.cm && editor.cm.state) {
			// best-effort fallback for CM6
			try {
				const sel = (editor.cm as any).state.selection.main;
				lineNum =
					(editor.cm as any).state.doc.lineAt(sel.from).number - 1;
				col =
					sel.from -
					(editor.cm as any).state.doc.lineAt(sel.from).from;
			} catch {
				lineNum = 0;
				col = 0;
			}
		}
	}
	ctx.lineNumber = lineNum;
	ctx.column = col;

	const lines = (content ?? "").split(/\r?\n/);
	ctx.lineText = lines[lineNum] ?? "";
	ctx.prevLineText = lines[lineNum - 1] ?? undefined;
	ctx.nextLineText = lines[lineNum + 1] ?? undefined;
	ctx.lineIsTask = /^\s*[-*+]\s*\[.?\]/.test(ctx.lineText || "");

	// Find a template wrapper on the same line (or previous line) by string matching as a robust fallback
	const contentRoot = resolveContentRoot(view);
	let foundWrapper: HTMLElement | null = null;
	if (contentRoot) {
		const wrappers = Array.from(
			contentRoot.querySelectorAll("[data-template-wrapper]")
		) as HTMLElement[];
		for (const w of wrappers) {
			const txt = (w.textContent ?? "").trim();
			// match by textual inclusion or equality with line text or previous line
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
		// try to find the mark inside to read data-order-tag
		const mark = foundWrapper.querySelector(
			"mark[data-template-id]"
		) as HTMLElement | null;
		if (mark) ctx.wrapperOrderTag = mark.getAttribute("data-order-tag");
	}

	return ctx as CursorContext;
}
