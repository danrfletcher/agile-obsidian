/**
 * App: Wire Obsidian editor checkbox behavior to our status sequencing,
 * with long-press-to-cancel, flicker prevention, and scroll stability.
 */
import type { App, Editor, Plugin } from "obsidian";
import { MarkdownView } from "obsidian";
import { getCheckboxStatusChar } from "@platform/obsidian";
import { publishTaskStatusChanged } from "./events/task-status-events";
import { LONG_PRESS_CANCEL_MS } from "./constants";
import {
	DEFAULT_STATUS_SEQUENCE,
	normalizeStatusInput,
} from "../domain/task-status-sequence";
import {
	advanceTaskStatusAtEditorLine,
	findPosFromEvent,
	isPosOnCheckboxToken,
	setTaskStatusAtEditorLine,
} from "../infra/obsidian/editor-status-mutations";

/**
 * Wire up editor-change handling so that clicking a checkbox in an open note
 * follows our custom circular sequence and supports long-press-to-cancel ("-").
 *
 * - Prevent default on pointerdown within the checkbox token to avoid flicker/indent jump.
 * - Long-press applies immediately on timeout (not waiting for release).
 * - Short press applies on release (advance).
 * - After either path, suppress the subsequent click to prevent Obsidian's default toggle.
 * - Preserve editor scroll position across edits.
 */
export function wireTaskStatusSequence(app: App, plugin: Plugin) {
	// Per-view snapshots to diff line changes
	const viewSnapshots = new WeakMap<
		MarkdownView,
		{ path: string; lines: string[] }
	>();

	type PressState = {
		line0: number;
		filePath: string;
		timerId: number | null;
		longApplied: boolean;
	};
	const pressState = new WeakMap<MarkdownView, PressState>();

	// Ignore the immediate next editor-change after our programmatic edit
	const ignoreNextEditorChange = new WeakMap<MarkdownView, boolean>();

	// Swallow the immediate next click after handling a press
	const suppressNextClick = new WeakMap<MarkdownView, number>();
	const SUPPRESS_CLICK_MS = 600;

	const collectLines = (editor: Editor): string[] => {
		const out: string[] = [];
		const count = editor.lineCount();
		for (let i = 0; i < count; i++) out.push(editor.getLine(i));
		return out;
	};

	const detectTransitions = (
		prevLines: string[],
		nextLines: string[]
	): Array<{ line0: number; before: string; after: string }> => {
		const maxLen = Math.max(prevLines.length, nextLines.length);
		const changes: Array<{ line0: number; before: string; after: string }> =
			[];
		let inspected = 0;

		for (let i = 0; i < maxLen; i++) {
			const beforeLine = prevLines[i] ?? "";
			const afterLine = nextLines[i] ?? "";
			if (beforeLine === afterLine) continue;

			const bRaw = (getCheckboxStatusChar(beforeLine) ?? "")
				.toString()
				.toLowerCase();
			const aRaw = (getCheckboxStatusChar(afterLine) ?? "")
				.toString()
				.toLowerCase();

			if (bRaw === aRaw) {
				if (++inspected > 500) break;
				continue;
			}
			if (!bRaw && !aRaw) {
				if (++inspected > 500) break;
				continue;
			}
			changes.push({ line0: i, before: bRaw, after: aRaw });
			if (++inspected > 500) break;
		}
		return changes;
	};

	const tryImmediateHandleForView = (view: MarkdownView) => {
		const file = view.file;
		if (!file || file.extension !== "md") return;
		const path = file.path;

		const editor: any = (view as any).editor;
		if (!editor) return;

		const nextLines = collectLines(editor);
		const snap = viewSnapshots.get(view);
		if (!snap || snap.path !== path) {
			viewSnapshots.set(view, { path, lines: nextLines });
			return;
		}

		if (ignoreNextEditorChange.get(view)) {
			ignoreNextEditorChange.delete(view);
			viewSnapshots.set(view, { path, lines: nextLines });
			return;
		}

		const prevLines = snap.lines;
		const transitions = detectTransitions(prevLines, nextLines);
		if (transitions.length === 0) {
			viewSnapshots.set(view, { path, lines: nextLines });
			return;
		}

		const last = transitions[transitions.length - 1];
		const before = normalizeStatusInput(last.before);
		const after = normalizeStatusInput(last.after);
		if (before || after) {
			publishTaskStatusChanged({
				filePath: path,
				id: "",
				line0: last.line0,
				fromStatus: before,
				toStatus: after,
			});
		}

		viewSnapshots.set(view, { path, lines: nextLines });
	};

	const onEditorChangeAny = (...args: any[]) => {
		try {
			let mdView: any = null;
			if (args.length === 1 && args[0] instanceof MarkdownView) {
				mdView = args[0];
			} else if (args.length >= 2 && args[1] instanceof MarkdownView) {
				mdView = args[1];
			} else {
				mdView =
					app.workspace.getActiveViewOfType(MarkdownView) ?? null;
			}
			if (!(mdView instanceof MarkdownView)) return;
			tryImmediateHandleForView(mdView);
		} catch (e) {
			console.warn(
				"[task-status-sequencer] editor-change handler failed",
				e
			);
		}
	};

	plugin.registerEvent(
		app.workspace.on("editor-change", onEditorChangeAny as any)
	);

	plugin.registerEvent(
		app.workspace.on("active-leaf-change", (_leaf) => {
			try {
				const view = app.workspace.getActiveViewOfType(MarkdownView);
				if (!view || !view.file) return;
				const editor: any = (view as any).editor;
				if (!editor) return;
				viewSnapshots.set(view, {
					path: view.file.path,
					lines: collectLines(editor),
				});
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
				viewSnapshots.set(view, {
					path: view.file.path,
					lines: collectLines(editor),
				});
			} catch {}
		})
	);

	// Pointer-based press handling
	const onPointerDown = (evt: PointerEvent) => {
		try {
			const view = app.workspace.getActiveViewOfType(MarkdownView);
			if (!view || !view.file) return;
			const editor: any = (view as any).editor;
			if (!editor) return;

			const container: HTMLElement | null =
				(view as any).contentEl || (view as any).containerEl || null;
			if (!container || !container.contains(evt.target as Node)) return;

			const pos = findPosFromEvent(editor, evt as any);
			if (!pos) return;
			const line0 = pos.line;
			const lineText = editor.getLine(line0) ?? "";
			if (!isPosOnCheckboxToken(lineText, pos.ch)) return;

			// Stop default checkbox behavior early to avoid flicker/indent jump
			evt.preventDefault();
			evt.stopPropagation();
			// @ts-ignore
			evt.stopImmediatePropagation?.();

			const filePath = view.file?.path || "";
			const existing = pressState.get(view);
			if (existing?.timerId != null) {
				window.clearTimeout(existing.timerId);
			}
			const state: PressState = {
				line0,
				filePath,
				timerId: null,
				longApplied: false,
			};
			const timerId = window.setTimeout(() => {
				// Apply cancel immediately on long-press timeout
				try {
					const before = editor.getLine(state.line0) ?? "";
					if (getCheckboxStatusChar(before) == null) return;

					const res = setTaskStatusAtEditorLine(
						editor,
						state.line0,
						"-"
					);
					if (res.didChange) {
						ignoreNextEditorChange.set(view, true);
						publishTaskStatusChanged({
							filePath: state.filePath,
							id: "",
							line0: state.line0,
							fromStatus: res.from,
							toStatus: res.to,
						});
						try {
							viewSnapshots.set(view, {
								path: state.filePath,
								lines: collectLines(editor),
							});
						} catch {}
					}
					state.longApplied = true;

					// Ensure the click after release is swallowed
					suppressNextClick.set(view, Date.now());
				} catch {
					/* ignore */
				} finally {
					state.timerId = null;
				}
			}, LONG_PRESS_CANCEL_MS);
			state.timerId = timerId as unknown as number;
			pressState.set(view, state);
		} catch {
			/* ignore */
		}
	};

	const finishShortPressIfAny = (ev?: Event) => {
		try {
			const view = app.workspace.getActiveViewOfType(MarkdownView);
			if (!view || !view.file) return;
			const editor: any = (view as any).editor;
			if (!editor) return;

			const state = pressState.get(view);
			if (!state) return;

			// Clear any pending timer if still running
			if (state.timerId != null) {
				window.clearTimeout(state.timerId);
				state.timerId = null;
			}

			const path = state.filePath;
			const line0 = state.line0;

			// If long-press already applied, just swallow the release/click
			if (state.longApplied) {
				suppressNextClick.set(view, Date.now());
				pressState.delete(view);

				if (ev) {
					try {
						ev.preventDefault();
						ev.stopPropagation();
						// @ts-ignore
						(ev as any).stopImmediatePropagation?.();
					} catch {}
				}
				return;
			}

			// Short press → advance on release
			const before = editor.getLine(line0) ?? "";
			const from = getCheckboxStatusChar(before);
			if (from == null) {
				pressState.delete(view);
				return;
			}

			const applied = advanceTaskStatusAtEditorLine(
				editor,
				line0,
				DEFAULT_STATUS_SEQUENCE
			);
			if (applied.didChange && applied.to) {
				ignoreNextEditorChange.set(view, true);
				publishTaskStatusChanged({
					filePath: path,
					id: "",
					line0,
					fromStatus: applied.from,
					toStatus: applied.to,
				});
				try {
					viewSnapshots.set(view, {
						path,
						lines: collectLines(editor),
					});
				} catch {}
			}

			// Swallow the immediate next click generated by this press
			suppressNextClick.set(view, Date.now());
			pressState.delete(view);

			if (ev) {
				try {
					ev.preventDefault();
					ev.stopPropagation();
					// @ts-ignore
					(ev as any).stopImmediatePropagation?.();
				} catch {}
			}
		} catch {
			/* ignore */
		}
	};

	const onPointerUpOrCancel = (evt: Event) => {
		finishShortPressIfAny(evt);
	};

	plugin.registerDomEvent(document, "pointerdown", onPointerDown as any);
	plugin.registerDomEvent(document, "pointerup", onPointerUpOrCancel as any);
	plugin.registerDomEvent(
		document,
		"pointercancel",
		onPointerUpOrCancel as any
	);

	// Swallow the click right after we handled a press to prevent Obsidian's default toggle
	const onClickCapture = (evt: MouseEvent) => {
		try {
			const view = app.workspace.getActiveViewOfType(MarkdownView);
			if (!view) return;

			const container: HTMLElement | null =
				(view as any).contentEl || (view as any).containerEl || null;
			if (!container || !container.contains(evt.target as Node)) return;

			const ts = suppressNextClick.get(view);
			if (ts && Date.now() - ts <= SUPPRESS_CLICK_MS) {
				evt.preventDefault();
				// @ts-ignore
				evt.stopImmediatePropagation?.();
				evt.stopPropagation();
				suppressNextClick.delete(view);
			}
		} catch {
			/* ignore */
		}
	};
	plugin.registerDomEvent(
		document,
		"click",
		onClickCapture as any,
		{ capture: true } as any
	);
}

// Re-export for external compatibility
export { findLineFromEvent } from "../infra/obsidian/editor-status-mutations";
