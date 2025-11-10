import type { App, Plugin } from "obsidian";
import { MarkdownView, Notice, TFile } from "obsidian";
import type { TaskIndexService } from "@features/task-index";
import {
	getCheckboxStatusChar,
	indentWidth,
	isListLine,
	isTaskLine,
} from "@platform/obsidian";
import { escapeRegExp } from "@utils";
import {
	appendEmojiWithDate,
	CANCELLED_EMOJI,
	COMPLETED_EMOJI,
	hasEmoji,
	ISO_DATE_RE,
	removeEmoji,
} from "@features/task-close-manager";
import { setCheckboxStatusChar } from "@features/task-status-sequencer";

// ---------- types ----------
export type ClosedCascadePorts = { taskIndex?: TaskIndexService };

// ---------- local helpers ----------
function isLineCompleted(line: string): boolean {
	const status = (getCheckboxStatusChar(line) ?? "").toLowerCase();
	return status === "x" || hasEmoji(line, COMPLETED_EMOJI);
}

function isLineCancelled(line: string): boolean {
	const status = (getCheckboxStatusChar(line) ?? "").toLowerCase();
	return status === "-" || hasEmoji(line, CANCELLED_EMOJI);
}

function isLineClosed(line: string): boolean {
	return isLineCompleted(line) || isLineCancelled(line);
}

function isLineTaskIncomplete(line: string): boolean {
	return isTaskLine(line) && !isLineClosed(line);
}

function extractParentCloseIntent(line: string): {
	intent: "complete" | "cancel" | null;
	date: string | null;
} {
	const status = (getCheckboxStatusChar(line) ?? "").toLowerCase();
	if (status !== "x" && status !== "-") {
		return { intent: null, date: null };
	}
	const emoji = status === "x" ? COMPLETED_EMOJI : CANCELLED_EMOJI;
	const re = new RegExp(
		`${escapeRegExp(emoji)}\\s*(${ISO_DATE_RE.source})?`,
		"i"
	);
	const m = re.exec(line);
	const date = (m?.[1] ?? null) as string | null;
	return {
		intent: status === "x" ? "complete" : "cancel",
		date,
	};
}

function hasDescendantsByIndent(lines: string[], parentLine0: number): boolean {
	if (parentLine0 < 0 || parentLine0 >= lines.length) return false;
	if (!isListLine(lines[parentLine0])) return false;
	const parentIndent = indentWidth(lines[parentLine0]);
	for (let i = parentLine0 + 1; i < lines.length; i++) {
		const s = lines[i];
		if (!isListLine(s)) {
			const iw = indentWidth(s);
			if (iw <= parentIndent && s.trim().length > 0) break;
			continue;
		}
		const iw = indentWidth(s);
		if (iw <= parentIndent) break;
		// Found a deeper list line => parent has descendants
		return true;
	}
	return false;
}

/**
 * Determine if a cascade would actually change any descendant lines
 * (i.e., there exists at least one incomplete checkbox task under the parent).
 */
function wouldCascade(lines: string[], parentLine0: number): boolean {
	if (!hasDescendantsByIndent(lines, parentLine0)) return false;
	const parentIndent = indentWidth(lines[parentLine0]);
	for (let i = parentLine0 + 1; i < lines.length; i++) {
		const s = lines[i] ?? "";
		if (!isListLine(s)) {
			const trimmed = s.trim();
			const iw = indentWidth(s);
			if (trimmed.length > 0 && iw <= parentIndent) break;
			continue;
		}
		const iw = indentWidth(s);
		if (iw <= parentIndent) break;

		// Check only checkbox tasks and see if any are not closed
		if (isLineTaskIncomplete(s)) {
			return true;
		}
	}
	return false;
}

// ---------- floating dialog (toggle) ----------
/**
 * Simple floating dialog asking whether to cascade close to incomplete subtasks.
 * Returns true if the user toggles ON and confirms; false otherwise.
 * Default is OFF.
 */
function showCascadeToggleDialog(): Promise<boolean> {
	return new Promise((resolve) => {
		// Backdrop
		const backdrop = document.createElement("div");
		backdrop.style.position = "fixed";
		backdrop.style.inset = "0";
		backdrop.style.background = "rgba(0,0,0,0.35)";
		backdrop.style.zIndex = "9999";
		backdrop.style.display = "flex";
		backdrop.style.alignItems = "center";
		backdrop.style.justifyContent = "center";

		// Panel
		const panel = document.createElement("div");
		panel.style.background = "var(--background-primary, #1e1e1e)";
		panel.style.color = "var(--text-normal, #ddd)";
		panel.style.minWidth = "340px";
		panel.style.maxWidth = "520px";
		panel.style.padding = "16px 18px";
		panel.style.borderRadius = "10px";
		panel.style.boxShadow = "0 8px 30px rgba(0,0,0,0.35)";
		panel.style.border =
			"1px solid var(--background-modifier-border, #444)";

		// Title
		const h = document.createElement("div");

		// Description
		const p = document.createElement("div");

		// Toggle row
		const row = document.createElement("label");
		row.style.display = "flex";
		row.style.alignItems = "center";
		row.style.justifyContent = "space-between";
		row.style.gap = "12px";
		row.style.margin = "8px 0 16px";

		const lbl = document.createElement("span");
		lbl.textContent = "Close all incomplete subtasks?";
		lbl.style.fontSize = "13px";

		const input = document.createElement("input");
		input.type = "checkbox";
		input.checked = false;
		input.setAttribute("aria-label", "Close all incomplete subtasks?");

		row.appendChild(lbl);
		row.appendChild(input);

		// Buttons
		const btns = document.createElement("div");
		btns.style.display = "flex";
		btns.style.justifyContent = "flex-end";
		btns.style.gap = "8px";

		const cancel = document.createElement("button");
		cancel.textContent = "Dismiss";
		cancel.style.background = "transparent";
		cancel.style.color = "var(--text-muted, #aaa)";
		cancel.style.border =
			"1px solid var(--background-modifier-border, #444)";
		cancel.style.padding = "6px 10px";
		cancel.style.borderRadius = "6px";
		cancel.style.cursor = "pointer";

		const confirm = document.createElement("button");
		confirm.textContent = "Apply";
		confirm.style.background = "var(--interactive-accent, #6c9)";
		confirm.style.color = "#000";
		confirm.style.border = "none";
		confirm.style.padding = "6px 12px";
		confirm.style.borderRadius = "6px";
		confirm.style.cursor = "pointer";
		confirm.style.fontWeight = "600";

		btns.appendChild(cancel);
		btns.appendChild(confirm);

		panel.appendChild(h);
		panel.appendChild(p);
		panel.appendChild(row);
		panel.appendChild(btns);
		backdrop.appendChild(panel);
		document.body.appendChild(backdrop);

		const cleanup = () => {
			try {
				document.body.removeChild(backdrop);
			} catch {}
			document.removeEventListener("keydown", onKey);
		};

		const done = (value: boolean) => {
			cleanup();
			resolve(value);
		};

		const onKey = (ev: KeyboardEvent) => {
			if (ev.key === "Escape") {
				ev.preventDefault();
				done(false);
			} else if (ev.key === "Enter") {
				ev.preventDefault();
				done(input.checked === true);
			}
		};

		confirm.addEventListener("click", () => done(input.checked === true));
		cancel.addEventListener("click", () => done(false));
		backdrop.addEventListener("click", (e) => {
			// Click outside panel dismisses
			if (e.target === backdrop) done(false);
		});
		document.addEventListener("keydown", onKey);
	});
}

// Global prompt de-dup by (filePath:line0)
const recentlyPrompted = new Map<string, number>();
function markPrompted(key: string, ms = 1500) {
	recentlyPrompted.set(key, Date.now() + ms);
}
function wasRecentlyPrompted(key: string): boolean {
	const until = recentlyPrompted.get(key);
	if (!until) return false;
	if (Date.now() <= until) return true;
	recentlyPrompted.delete(key);
	return false;
}

// ---------- core ----------
export async function applyClosedCascade(
	app: App,
	filePath: string,
	editor: any,
	parentLine0: number,
	_beforeLines: string[] | null | undefined,
	_ports?: ClosedCascadePorts
): Promise<void> {
	try {
		const afterLines: string[] = editor.getValue().split(/\r?\n/);

		// Determine parent's new state and date
		const parentLine = afterLines[parentLine0] ?? "";
		const { intent, date } = extractParentCloseIntent(parentLine);
		if (!intent) {
			// Parent line isn't in a closed state; nothing to cascade.
			return;
		}
		const targetEmoji =
			intent === "complete" ? COMPLETED_EMOJI : CANCELLED_EMOJI;
		const targetStatusChar = intent === "complete" ? "x" : "-";

		// Collect descendants using indentation
		const descendants: number[] = [];
		if (
			parentLine0 >= 0 &&
			parentLine0 < afterLines.length &&
			isListLine(afterLines[parentLine0])
		) {
			const parentIndent = indentWidth(afterLines[parentLine0]);
			for (let i = parentLine0 + 1; i < afterLines.length; i++) {
				const s = afterLines[i];
				if (!isListLine(s)) {
					const trimmed = (s ?? "").trim();
					const iw = indentWidth(s);
					if (trimmed.length > 0 && iw <= parentIndent) break;
					continue;
				}
				const iw = indentWidth(s);
				if (iw <= parentIndent) break;
				descendants.push(i);
			}
		}

		// Apply cascading closure to descendants
		for (const line0 of descendants) {
			if (line0 === parentLine0) continue;
			const orig = editor.getLine(line0) ?? "";

			// Only consider checkbox task lines
			if (!isTaskLine(orig)) continue;

			// Skip if already completed or cancelled
			if (isLineClosed(orig)) continue;

			// Update checkbox status
			let updated = setCheckboxStatusChar(orig, targetStatusChar);

			// Remove any stale marker of the opposite kind defensively
			const otherEmoji =
				targetEmoji === COMPLETED_EMOJI
					? CANCELLED_EMOJI
					: COMPLETED_EMOJI;
			if (hasEmoji(updated, otherEmoji)) {
				updated = removeEmoji(updated, otherEmoji);
			}
			// Remove duplicates of the target emoji before appending
			if (hasEmoji(updated, targetEmoji)) {
				updated = removeEmoji(updated, targetEmoji);
			}
			// Append target emoji with parent's date (if any)
			updated = appendEmojiWithDate(
				updated,
				targetEmoji,
				date ?? undefined
			);

			// Normalize trailing space
			updated = updated.replace(/\s+$/, " ");

			if (updated !== orig) {
				editor.replaceRange(
					updated,
					{ line: line0, ch: 0 },
					{ line: line0, ch: orig.length }
				);
			}
		}
	} catch (err) {
		console.error(
			"[task-closed-cascade] error:",
			(err as any)?.message ?? err
		);
	}
}

/**
 * Ask user whether to cascade if it would actually change any subtasks.
 * Returns true if cascade was executed, false if not.
 */
async function maybePromptAndCascadeInEditor(
	app: App,
	path: string,
	editor: any,
	parentLine0: number,
	beforeLines?: string[] | null
): Promise<boolean> {
	const linesNow: string[] = [];
	const lc = editor.lineCount?.() ?? 0;
	for (let i = 0; i < lc; i++) linesNow.push(editor.getLine(i));

	// Only prompt if cascade would actually affect incomplete subtasks.
	if (!wouldCascade(linesNow, parentLine0)) {
		return false;
	}

	const key = `${path}:${parentLine0}`;
	if (wasRecentlyPrompted(key)) {
		return false;
	}
	markPrompted(key);

	const allowCascade = await showCascadeToggleDialog();
	if (!allowCascade) {
		return false;
	}

	await applyClosedCascade(
		app,
		path,
		editor,
		parentLine0,
		beforeLines ?? null
	);
	return true;
}

async function maybePromptAndCascadeHeadless(
	app: App,
	path: string,
	parentLine0: number,
	beforeLines?: string[] | null
): Promise<boolean> {
	const abs = app.vault.getAbstractFileByPath(path);
	if (!(abs instanceof TFile)) return false;

	const afterContent = await app.vault.read(abs);
	const afterLines = afterContent.split(/\r?\n/);

	// Only prompt if cascade would actually affect incomplete subtasks.
	if (!wouldCascade(afterLines, parentLine0)) {
		return false;
	}

	const key = `${path}:${parentLine0}`;
	if (wasRecentlyPrompted(key)) {
		return false;
	}
	markPrompted(key);

	const allowCascade = await showCascadeToggleDialog();
	if (!allowCascade) {
		return false;
	}

	// Headless editor for mutation
	class HeadlessEditor {
		private _lines: string[];
		constructor(lines: string[]) {
			this._lines = lines.slice();
		}
		getValue(): string {
			return this._lines.join("\n");
		}
		getLine(n: number): string {
			return this._lines[n] ?? "";
		}
		replaceRange(
			newText: string,
			from: { line: number; ch: number },
			_to: { line: number; ch: number }
		) {
			const lineNo = from.line;
			this._lines[lineNo] = newText;
		}
		dumpLines(): string[] {
			return this._lines.slice();
		}
	}
	const headlessEditor = new HeadlessEditor(afterLines);

	await applyClosedCascade(
		app,
		path,
		headlessEditor as any,
		parentLine0,
		beforeLines ?? null
	);

	const newLines = headlessEditor.dumpLines();
	if (newLines.join("\n") !== afterContent) {
		try {
			window.dispatchEvent(
				new CustomEvent("agile:prepare-optimistic-file-change", {
					detail: { filePath: path },
				})
			);
		} catch {}
		await app.vault.modify(abs, newLines.join("\n"));
	}
	return true;
}

// ---------- event wiring (custom-event adapter; optional) ----------
export function wireTaskClosedCascade(
	app: App,
	plugin: Plugin,
	_ports?: ClosedCascadePorts
) {
	const onTaskClosed = async (evt: Event) => {
		const ce = evt as CustomEvent<{
			filePath: string;
			parentLine0: number; // 0-based line index
			beforeLines?: string[] | null;
		}>;
		const detail = ce?.detail;
		if (!detail) return;

		const { filePath, parentLine0, beforeLines } = detail;

		try {
			// Avoid double handling if we already prompted on the observer path
			const key = `${filePath}:${parentLine0}`;
			if (wasRecentlyPrompted(key)) return;

			const view =
				app.workspace.getActiveViewOfType(MarkdownView) ?? null;

			if (view && view.file && view.file.path === filePath) {
				const editor: any = (view as any).editor;
				if (!editor) return;

				await maybePromptAndCascadeInEditor(
					app,
					filePath,
					editor,
					parentLine0,
					beforeLines ?? null
				);
				return;
			}

			// Headless branch: modify file contents directly
			await maybePromptAndCascadeHeadless(
				app,
				filePath,
				parentLine0,
				beforeLines ?? null
			);
		} catch (e) {
			new Notice(
				`Closed cascade failed: ${String((e as Error)?.message ?? e)}`
			);
		}
	};

	// Backward compatible: still listen to the generic event (custom commands may fire this)
	plugin.registerDomEvent(
		document,
		"agile:task-closed" as any,
		onTaskClosed as any
	);

	// New: listen to manager events so we prompt AFTER dates are added
	plugin.registerDomEvent(
		document,
		"agile:task-completed-date-added" as any,
		onTaskClosed as any
	);
	plugin.registerDomEvent(
		document,
		"agile:task-cancelled-date-added" as any,
		onTaskClosed as any
	);
}

// ---------- passive observer (works with Obsidian Tasks out of the box) ----------
export function wireTaskClosedCascadeObserver(
	app: App,
	plugin: Plugin,
	_ports?: ClosedCascadePorts
) {
	// Re-entrancy guard to avoid loops when we write changes
	const suppressedPaths = new Map<string, number>(); // path -> until timestamp

	const shouldSuppress = (path: string) => {
		const until = suppressedPaths.get(path);
		if (!until) return false;
		if (Date.now() <= until) return true;
		suppressedPaths.delete(path);
		return false;
	};
	const suppressNextFor = (path: string, ms: number) => {
		suppressedPaths.set(path, Date.now() + ms);
	};

	// Per-view snapshots and file snapshots for headless changes
	const viewSnapshots = new WeakMap<
		MarkdownView,
		{ path: string; lines: string[] }
	>();
	const fileSnapshots = new Map<string, string[]>();

	const detectTransitions = (
		prevLines: string[],
		nextLines: string[]
	): Array<{ line0: number; intent: "complete" | "cancel" }> => {
		const maxLen = Math.max(prevLines.length, nextLines.length);
		const changes: Array<{ line0: number; intent: "complete" | "cancel" }> =
			[];

		let inspected = 0;
		for (let i = 0; i < maxLen; i++) {
			const before = prevLines[i] ?? "";
			const after = nextLines[i] ?? "";
			if (before === after) continue;

			const wasTask = isTaskLine(before);
			const isTask = isTaskLine(after);
			if (!wasTask || !isTask) {
				if (++inspected > 200) break;
				continue;
			}

			const wasClosed = isLineClosed(before);
			const nowCompleted = isLineCompleted(after);
			const nowCancelled = isLineCancelled(after);

			if (!wasClosed && (nowCompleted || nowCancelled)) {
				changes.push({
					line0: i,
					intent: nowCompleted ? "complete" : "cancel",
				});
			}

			if (++inspected > 200) break;
		}
		return changes;
	};

	const tryCascadeForView = async (view: MarkdownView) => {
		const file = view.file;
		if (!file || file.extension !== "md") return;
		const path = file.path;
		if (shouldSuppress(path)) return;

		const editor: any = (view as any).editor;
		if (!editor) return;

		const nextLines: string[] = [];
		const count = editor.lineCount();
		for (let i = 0; i < count; i++) nextLines.push(editor.getLine(i));

		const snap = viewSnapshots.get(view);
		if (!snap || snap.path !== path) {
			viewSnapshots.set(view, { path, lines: nextLines });
			return;
		}
		const prevLines = snap.lines;

		const transitions = detectTransitions(prevLines, nextLines);
		if (transitions.length === 0) {
			viewSnapshots.set(view, { path, lines: nextLines });
			return;
		}

		// Most recent change heuristics: take the last one
		const last = transitions[transitions.length - 1];

		// Only consider if the changed line has descendants AND at least one incomplete task descendant
		if (!wouldCascade(nextLines, last.line0)) {
			viewSnapshots.set(view, { path, lines: nextLines });
			return;
		}

		// De-dupe: mark prompted so the date-added event path won't prompt again
		const key = `${path}:${last.line0}`;
		if (wasRecentlyPrompted(key)) {
			viewSnapshots.set(view, { path, lines: nextLines });
			return;
		}
		markPrompted(key);

		// Ask user if they want to cascade
		const allowCascade = await showCascadeToggleDialog();
		if (!allowCascade) {
			// User chose not to cascade; don't suppress since we don't write
			viewSnapshots.set(view, { path, lines: nextLines });
			return;
		}

		// Suppress our own write feedback for a short window
		suppressNextFor(path, 800);

		try {
			await applyClosedCascade(app, path, editor, last.line0, prevLines);
		} finally {
			// Refresh snapshot after our edits
			const refreshed: string[] = [];
			const lc = editor.lineCount();
			for (let i = 0; i < lc; i++) refreshed.push(editor.getLine(i));
			viewSnapshots.set(view, { path, lines: refreshed });
		}
	};

	// FIX: correct signature (editor, mdView)
	plugin.registerEvent(
		app.workspace.on("editor-change", async (_editor: any, mdView: any) => {
			try {
				if (!(mdView instanceof MarkdownView)) return;
				await tryCascadeForView(mdView);
			} catch (e) {
				console.warn(
					"[task-closed-cascade] editor-change handler failed",
					e
				);
			}
		})
	);

	plugin.registerEvent(
		app.workspace.on("active-leaf-change", (_leaf) => {
			try {
				const view = app.workspace.getActiveViewOfType(MarkdownView);
				if (!view || !view.file) return;
				const editor: any = (view as any).editor;
				if (!editor) return;
				const lines: string[] = [];
				for (let i = 0; i < editor.lineCount(); i++)
					lines.push(editor.getLine(i));
				viewSnapshots.set(view, { path: view.file.path, lines });
				// Also seed file snapshot
				fileSnapshots.set(view.file.path, lines);
			} catch {}
		})
	);

	plugin.registerEvent(
		app.workspace.on("file-open", (_file) => {
			try {
				const view = app.workspace.getActiveViewOfType(MarkdownView);
				if (!view || !view.file) return;
				const editor: any = (view as any).editor;
				if (!editor) return;
				const lines: string[] = [];
				for (let i = 0; i < editor.lineCount(); i++)
					lines.push(editor.getLine(i));
				viewSnapshots.set(view, { path: view.file.path, lines });
				fileSnapshots.set(view.file.path, lines);
			} catch {}
		})
	);

	// Headless modify: detect toggles written by other plugins when not the active editor
	plugin.registerEvent(
		app.vault.on("modify", async (file) => {
			try {
				if (!(file instanceof TFile)) return;
				if (file.extension !== "md") return;
				const path = file.path;
				if (shouldSuppress(path)) return;

				// If active view is this file, let the editor-change handler manage it
				const active = app.workspace.getActiveViewOfType(MarkdownView);
				if (active && active.file && active.file.path === path) return;

				const nextContent = await app.vault.read(file);
				const nextLines = nextContent.split(/\r?\n/);
				const prevLines = fileSnapshots.get(path) ?? nextLines;

				const transitions = detectTransitions(prevLines, nextLines);
				if (transitions.length === 0) {
					fileSnapshots.set(path, nextLines);
					return;
				}

				const last = transitions[transitions.length - 1];

				// Only consider if cascade would actually affect incomplete subtasks
				if (!wouldCascade(nextLines, last.line0)) {
					fileSnapshots.set(path, nextLines);
					return;
				}

				// De-dupe prompting with other path
				const key = `${path}:${last.line0}`;
				if (wasRecentlyPrompted(key)) {
					fileSnapshots.set(path, nextLines);
					return;
				}
				markPrompted(key);

				const allowCascade = await showCascadeToggleDialog();
				if (!allowCascade) {
					fileSnapshots.set(path, nextLines);
					return;
				}

				// Headless editor
				class HeadlessEditor {
					private _lines: string[];
					constructor(lines: string[]) {
						this._lines = lines.slice();
					}
					getValue(): string {
						return this._lines.join("\n");
					}
					getLine(n: number): string {
						return this._lines[n] ?? "";
					}
					replaceRange(
						newText: string,
						from: { line: number; ch: number },
						_to: { line: number; ch: number }
					) {
						const lineNo = from.line;
						this._lines[lineNo] = newText;
					}
					dumpLines(): string[] {
						return this._lines.slice();
					}
				}
				const head = new HeadlessEditor(nextLines);

				// Suppress our own write feedback
				suppressNextFor(path, 800);

				await applyClosedCascade(
					app,
					path,
					head as any,
					last.line0,
					prevLines
				);

				const finalLines = head.dumpLines();
				if (finalLines.join("\n") !== nextContent) {
					try {
						window.dispatchEvent(
							new CustomEvent(
								"agile:prepare-optimistic-file-change",
								{
									detail: { filePath: path },
								}
							)
						);
					} catch {}
					await app.vault.modify(file, finalLines.join("\n"));
					fileSnapshots.set(path, finalLines);
				} else {
					fileSnapshots.set(path, nextLines);
				}
			} catch (e) {
				console.warn("[task-closed-cascade] headless modify failed", e);
			}
		})
	);

	// Seed snapshots immediately so the first toggle cascades
	const seedActiveViewSnapshot = () => {
		try {
			const view = app.workspace.getActiveViewOfType(MarkdownView);
			if (!view || !view.file) return;
			const editor: any = (view as any).editor;
			if (!editor) return;
			const lines: string[] = [];
			for (let i = 0; i < editor.lineCount(); i++)
				lines.push(editor.getLine(i));
			viewSnapshots.set(view, { path: view.file.path, lines });
			fileSnapshots.set(view.file.path, lines);
		} catch {}
	};
	seedActiveViewSnapshot();
	try {
		(app.workspace as any).onLayoutReady?.(seedActiveViewSnapshot);
	} catch {}
}
