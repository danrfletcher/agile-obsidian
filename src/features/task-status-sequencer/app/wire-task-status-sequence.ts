/**
 * App: Wire Obsidian editor checkbox behavior to our status sequencing,
 * with long-press-to-cancel, flicker prevention, and scroll stability.
 */
import type { App, Editor, Plugin, MarkdownFileInfo } from "obsidian";
import { MarkdownView } from "obsidian";
import {
	getCheckboxStatusChar,
	findPosFromEvent,
	isPosOnCheckboxToken,
} from "@platform/obsidian";
import { publishTaskStatusChanged } from "./events/task-status-events";
import { LONG_PRESS_CANCEL_MS } from "./constants";
import {
	DEFAULT_STATUS_SEQUENCE,
	normalizeStatusInput,
} from "../domain/task-status-sequence";
import {
	advanceTaskStatusAtEditorLine,
	setTaskStatusAtEditorLine,
} from "./task-status-for-task-item";

/**
 * Wire up editor-change handling so that clicking a checkbox in an open note
 * follows our custom circular sequence and supports long-press-to-cancel ("-").
 *
 * - Prevent default on pointerdown within the checkbox token to avoid flicker/indent jump.
 * - Long-press applies immediately on timeout (not waiting for release).
 * - Short press applies on release (advance).
 * - After either path, suppress the subsequent click to prevent Obsidian's default toggle.
 * - Preserve editor scroll position across edits (handled by applyLineTransform).
 * - Capture-phase click guard cancels label-synthesized checkbox toggles
 *   for clicks outside the "[ ]" token (e.g., on the fold chevron).
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

	type EventWithComposedPath = Event & {
		composedPath?: () => EventTarget[];
	};

	type EventWithStopImmediatePropagation = Event & {
		stopImmediatePropagation?: () => void;
	};

	type ViewWithContainers = MarkdownView & {
		contentEl?: HTMLElement;
		containerEl: HTMLElement;
	};

	// -------------------------
	// Helpers
	// -------------------------
	const getPathEls = (evt: Event): HTMLElement[] => {
		const eventWithPath = evt as EventWithComposedPath;
		const raw = eventWithPath.composedPath?.() ?? [];
		if (raw.length) {
			return raw.filter(
				(node): node is HTMLElement => node instanceof HTMLElement
			);
		}
		const out: HTMLElement[] = [];
		let el = evt.target instanceof HTMLElement ? evt.target : null;
		while (el) {
			out.push(el);
			el = el.parentElement;
		}
		return out;
	};

	// Detect fold chevron/bullet elements in the event path
	const isChevronEvent = (evt: Event): boolean => {
		const path = getPathEls(evt);
		return path.some((el) => {
			const c = el.classList;
			return (
				c?.contains("cm-fold-indicator") ||
				c?.contains("collapse-indicator") ||
				c?.contains("collapse-icon") ||
				c?.contains("cm-foldPlaceholder") ||
				c?.contains("HyperMD-list-bullet")
			);
		});
	};

	// Label/checkbox detection in the path
	const pathHitsLabelOrCheckbox = (
		evt: Event
	): {
		hitsLabel: boolean;
		hitsCheckbox: boolean;
	} => {
		let hitsLabel = false;
		let hitsCheckbox = false;
		for (const el of getPathEls(evt)) {
			if (
				el.tagName === "LABEL" ||
				el.classList?.contains?.("task-list-label")
			) {
				hitsLabel = true;
			}
			if (
				(el as HTMLInputElement).tagName === "INPUT" &&
				(el as HTMLInputElement).type === "checkbox"
			) {
				hitsCheckbox = true;
			}
		}
		return { hitsLabel, hitsCheckbox };
	};

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

		const editor = view.editor;
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

	const onEditorChange = (
		_editor: Editor,
		info: MarkdownView | MarkdownFileInfo
	): void => {
		try {
			const mdView =
				info instanceof MarkdownView
					? info
					: app.workspace.getActiveViewOfType(MarkdownView);

			if (!mdView) return;
			tryImmediateHandleForView(mdView);
		} catch (e) {
			console.warn(
				"[task-status-sequencer] editor-change handler failed",
				e
			);
		}
	};

	plugin.registerEvent(
		app.workspace.on("editor-change", onEditorChange)
	);

	plugin.registerEvent(
		app.workspace.on("active-leaf-change", (_leaf) => {
			try {
				const view = app.workspace.getActiveViewOfType(MarkdownView);
				if (!view || !view.file) return;
				const editor = view.editor;
				if (!editor) return;
				viewSnapshots.set(view, {
					path: view.file.path,
					lines: collectLines(editor),
				});
			} catch {
				/* ignore */
			}
		})
	);

	plugin.registerEvent(
		app.workspace.on("file-open", (_file) => {
			try {
				const view = app.workspace.getActiveViewOfType(MarkdownView);
				if (!view || !view.file) return;
				const editor = view.editor;
				if (!editor) return;
				viewSnapshots.set(view, {
					path: view.file.path,
					lines: collectLines(editor),
				});
			} catch {
				/* ignore */
			}
		})
	);

	// Pointer-based press handling
	const onPointerDown = (evt: PointerEvent) => {
		try {
			const view = app.workspace.getActiveViewOfType(MarkdownView);
			if (!view || !view.file) return;
			const editor = view.editor;
			if (!editor) return;

			const viewWithContainers = view as ViewWithContainers;
			const container =
				viewWithContainers.contentEl ?? viewWithContainers.containerEl;
			if (!container || !container.contains(evt.target as Node)) return;

			// If clicking the chevron/bullet, allow fold and do not intercept.
			if (isChevronEvent(evt)) return;

			const pos = findPosFromEvent(editor, evt);
			if (!pos) return;

			const line0 = pos.line;
			const lineText = editor.getLine(line0) ?? "";
			const onToken = isPosOnCheckboxToken(lineText, pos.ch);
			if (!onToken) {
				// Not on the checkbox token; let editor handle (including fold, caret, etc.)
				return;
			}

			// Stop default checkbox behavior early to avoid flicker/indent jump
			evt.preventDefault();
			evt.stopPropagation();
			(evt as EventWithStopImmediatePropagation).stopImmediatePropagation?.();

			const filePath = view.file?.path || "";
			const state = pressState.get(view);
			if (state?.timerId != null) {
				window.clearTimeout(state.timerId);
			}
			const nextState: PressState = {
				line0,
				filePath,
				timerId: null,
				longApplied: false,
			};
			const timerId = window.setTimeout(() => {
				// Apply cancel immediately on long-press timeout
				try {
					const before = editor.getLine(nextState.line0) ?? "";
					if (getCheckboxStatusChar(before) == null) return;

					const res = setTaskStatusAtEditorLine(
						editor,
						nextState.line0,
						"-"
					);
					if (res.didChange) {
						ignoreNextEditorChange.set(view, true);
						publishTaskStatusChanged({
							filePath: nextState.filePath,
							id: "",
							line0: nextState.line0,
							fromStatus: res.from,
							toStatus: res.to,
						});
						try {
							viewSnapshots.set(view, {
								path: nextState.filePath,
								lines: collectLines(editor),
							});
						} catch {
							/* ignore */
						}
					}
					nextState.longApplied = true;

					// Ensure the click after release is swallowed
					suppressNextClick.set(view, Date.now());
				} catch {
					/* ignore */
				} finally {
					nextState.timerId = null;
				}
			}, LONG_PRESS_CANCEL_MS);
			nextState.timerId = timerId as unknown as number;
			pressState.set(view, nextState);
		} catch {
			/* ignore */
		}
	};

	const finishShortPressIfAny = (ev?: Event) => {
		try {
			const view = app.workspace.getActiveViewOfType(MarkdownView);
			if (!view || !view.file) return;
			const editor = view.editor;
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
						(
							ev as EventWithStopImmediatePropagation
						).stopImmediatePropagation?.();
					} catch {
						/* ignore */
					}
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
				} catch {
					/* ignore */
				}
			}

			// Swallow the immediate next click generated by this press
			suppressNextClick.set(view, Date.now());
			pressState.delete(view);

			if (ev) {
				try {
					ev.preventDefault();
					ev.stopPropagation();
					(
						ev as EventWithStopImmediatePropagation
					).stopImmediatePropagation?.();
				} catch {
					/* ignore */
				}
			}
		} catch {
			/* ignore */
		}
	};

	const onPointerUpOrCancel = (evt: Event) => {
		finishShortPressIfAny(evt);
	};

	plugin.registerDomEvent(document, "pointerdown", onPointerDown);
	plugin.registerDomEvent(document, "pointerup", onPointerUpOrCancel);
	plugin.registerDomEvent(document, "pointercancel", onPointerUpOrCancel);

	// Capture-phase click guard:
	// - Case 1: Immediately after our handled press → fully swallow (prevent + stop*).
	// - Case 2: Click outside the "[ ]" token that routes through label/input (label-synth) → preventDefault only.
	const onClickCapture = (evt: MouseEvent) => {
		try {
			const view = app.workspace.getActiveViewOfType(MarkdownView);
			if (!view) return;

			const viewWithContainers = view as ViewWithContainers;
			const container =
				viewWithContainers.contentEl ?? viewWithContainers.containerEl;
			if (!container || !container.contains(evt.target as Node)) return;

			// Case 1: swallow click after our own press handling
			const ts = suppressNextClick.get(view);
			if (ts && Date.now() - ts <= SUPPRESS_CLICK_MS) {
				evt.preventDefault();
				(
					evt as EventWithStopImmediatePropagation
				).stopImmediatePropagation?.();
				evt.stopPropagation();
				suppressNextClick.delete(view);
				return;
			}

			const editor = view.editor;
			if (!editor) return;

			const pos = findPosFromEvent(editor, evt);
			if (!pos) return;

			const lineText = editor.getLine(pos.line) ?? "";
			const onToken = isPosOnCheckboxToken(lineText, pos.ch);

			const { hitsLabel, hitsCheckbox } = pathHitsLabelOrCheckbox(evt);

			// Case 2: prevent label-synthesized toggles when not clicking the "[ ]" token
			if (
				getCheckboxStatusChar(lineText) != null &&
				!onToken &&
				(hitsLabel || hitsCheckbox)
			) {
				evt.preventDefault();
				// Do NOT stop propagation; allow fold handlers to run.
				return;
			}
		} catch {
			/* ignore */
		}
	};

	plugin.registerDomEvent(document, "click", onClickCapture, {
		capture: true,
	});
}