import type { App, Editor, Plugin, TFile } from "obsidian";
import { MarkdownView, TFile as ObsidianTFile } from "obsidian";
import { getCheckboxStatusChar } from "@platform/obsidian";
import { setCheckboxStatusChar } from "../domain/task-status-utils";

export type StatusChar = " " | "x" | "-" | "/";

/**
 * Default circular sequence for task statuses when clicking a checkbox:
 *   " " → "/" → "x" → "-" → " " → ...
 */
export const DEFAULT_STATUS_SEQUENCE: ReadonlyArray<StatusChar> = [
	" ",
	"/",
	"x",
	"-",
];

/** Default long-press threshold (ms) for cancel intent. */
export const LONG_PRESS_CANCEL_MS = 500;

/**
 * Normalize a status-like input into a canonical single-char string.
 * - Treats "" (empty) as " " (unchecked) so that sequence advances to "/".
 * - Downcases "X" to "x".
 */
function normalizeStatusInput(current: string | null | undefined): string {
	const s = (current ?? "").toString().toLowerCase();
	if (s === "" || s === " ") return " ";
	if (s === "x" || s === "-" || s === "/") return s;
	return s.length === 1 ? s : " ";
}

/**
 * Return the next status char in a circular sequence.
 * If current is not found (including ""), start from " ".
 */
export function getNextStatusChar(
	current: string | null | undefined,
	sequence: ReadonlyArray<StatusChar> = DEFAULT_STATUS_SEQUENCE
): StatusChar {
	const norm = normalizeStatusInput(current);
	const canonical = (norm === "" ? " " : norm) as string;
	const idx = sequence.findIndex((c) => c === canonical);
	if (idx < 0) return sequence[0];
	const next = (idx + 1) % sequence.length;
	return sequence[next];
}

/**
 * Produce a new line string with the checkbox status advanced to the next char.
 * Returns the updated line (or the original if not a task line).
 */
export function updateLineWithNextStatus(
	line: string,
	sequence: ReadonlyArray<StatusChar> = DEFAULT_STATUS_SEQUENCE
): string {
	const present = getCheckboxStatusChar(line);
	if (present == null) return line;
	const next = getNextStatusChar(present, sequence);
	return setCheckboxStatusChar(line, next);
}

/**
 * Advance the task status at a specific editor line according to the provided sequence.
 * Returns details about the change.
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
	editor.replaceRange(
		updated,
		{ line: line0, ch: 0 },
		{ line: line0, ch: orig.length }
	);
	return { from, to, didChange: true };
}

/**
 * Set the task status at a specific editor line to an explicit target char.
 * Returns details about the change.
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
	// Preserve selection/cursor if on the same line
	let fromSel: any = editor.getCursor?.("from");
	let toSel: any = editor.getCursor?.("to");
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

	return { from, to, didChange: true };
}

/**
 * Compute a position from a mouse or keyboard-triggered event relative to the editor.
 */
function findPosFromEvent(
	editor: Editor,
	evt: MouseEvent | KeyboardEvent
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
		// ignore
	}
	try {
		const cur = editor.getCursor();
		return { line: cur.line ?? 0, ch: cur.ch ?? 0 };
	} catch {
		return null;
	}
}

/**
 * Legacy export retained for compatibility.
 */
export function findLineFromEvent(
	editor: Editor,
	evt: MouseEvent | KeyboardEvent
): number {
	const p = findPosFromEvent(editor, evt);
	return p?.line ?? editor.getCursor().line ?? 0;
}

/**
 * Determine if a position is within the checkbox "[ ]" token of a task line.
 * We locate "[...]" after the list marker (e.g., "- " or "1. ").
 */
function isPosOnCheckboxToken(lineText: string, ch: number): boolean {
	// Is it a task line?
	if (getCheckboxStatusChar(lineText) == null) return false;

	// Find end of list marker
	const m = lineText.match(/^\s*(?:[-*+]|\d+[.)])\s*/);
	const markerEnd = m ? m[0].length : 0;

	// Find "[" after marker
	const openIdx = lineText.indexOf("[", markerEnd);
	if (openIdx < 0) return false;
	// Find matching "]" shortly after
	const closeIdx = lineText.indexOf("]", openIdx);
	if (closeIdx < 0) return false;

	// Only treat clicks within the bracket token as checkbox clicks
	return ch >= openIdx && ch <= closeIdx + 1;
}

/**
 * Headless helper: Compute the next status for a given checkbox line string.
 */
export function computeDesiredNextFromLine(
	line: string,
	sequence: ReadonlyArray<StatusChar> = DEFAULT_STATUS_SEQUENCE
): StatusChar {
	const present = getCheckboxStatusChar(line);
	return getNextStatusChar(present, sequence);
}

/**
 * Headless helper: Advance a task's status given file path and line index (0-based).
 * Emits "agile:task-status-changed".
 */
export async function advanceTaskStatusByFileLine(params: {
	app: App;
	filePath: string;
	line0: number;
	sequence?: ReadonlyArray<StatusChar>;
}): Promise<void> {
	const { app, filePath, line0, sequence = DEFAULT_STATUS_SEQUENCE } = params;

	const abs = app.vault.getAbstractFileByPath(filePath);
	if (!(abs instanceof ObsidianTFile)) return;
	const tfile = abs as TFile;

	const content: string = await app.vault.read(tfile);
	const lines = content.split(/\r?\n/);
	const orig = lines[line0] ?? "";
	const from = getCheckboxStatusChar(orig);
	if (from == null) return;

	const to = getNextStatusChar(from, sequence);
	const updated = setCheckboxStatusChar(orig, to);
	if (updated !== orig) {
		lines[line0] = updated;
		await app.vault.modify(tfile, lines.join("\n"));
	}

	try {
		document.dispatchEvent(
			new CustomEvent("agile:task-status-changed" as any, {
				detail: {
					filePath,
					id: "",
					line0,
					fromStatus: from,
					toStatus: to,
				},
			})
		);
	} catch {
		// ignore
	}
}

/**
 * Headless helper: Set a task's status by file/line to an explicit target char.
 * Emits "agile:task-status-changed".
 */
export async function setTaskStatusByFileLine(params: {
	app: App;
	filePath: string;
	line0: number;
	to: StatusChar;
}): Promise<void> {
	const { app, filePath, line0, to } = params;

	const abs = app.vault.getAbstractFileByPath(filePath);
	if (!(abs instanceof ObsidianTFile)) return;
	const tfile = abs as TFile;

	const content: string = await app.vault.read(tfile);
	const lines = content.split(/\r?\n/);
	const orig = lines[line0] ?? "";
	const from = getCheckboxStatusChar(orig);
	if (from == null) return;

	const updated = setCheckboxStatusChar(orig, to);
	if (updated !== orig) {
		lines[line0] = updated;
		await app.vault.modify(tfile, lines.join("\n"));
	}

	try {
		document.dispatchEvent(
			new CustomEvent("agile:task-status-changed" as any, {
				detail: {
					filePath,
					id: "",
					line0,
					fromStatus: from,
					toStatus: to,
				},
			})
		);
	} catch {
		// ignore
	}
}

/**
 * Convenience: Advance status for a "TaskItem-like" object.
 * Emits "agile:task-status-changed".
 */
export async function advanceTaskStatusForTaskItem(params: {
	app: App;
	task: {
		filePath: string;
		line0: number;
		status?: string | null | undefined;
	};
	sequence?: ReadonlyArray<StatusChar>;
}): Promise<void> {
	const { app, task, sequence = DEFAULT_STATUS_SEQUENCE } = params;
	const { filePath, line0 } = task;
	if (!filePath || typeof line0 !== "number") return;

	const activeView = app.workspace.getActiveViewOfType(MarkdownView);
	const editor: Editor | null =
		activeView && activeView.file?.path === filePath
			? ((activeView as any).editor as Editor)
			: null;

	if (editor) {
		const from = getCheckboxStatusChar(editor.getLine(line0) ?? "");
		if (from == null) return;
		const to = getNextStatusChar(
			task.status != null ? task.status : from,
			sequence
		);
		advanceTaskStatusAtEditorLine(editor, line0, sequence);
		try {
			document.dispatchEvent(
				new CustomEvent("agile:task-status-changed" as any, {
					detail: {
						filePath,
						id: "",
						line0,
						fromStatus: from,
						toStatus: to,
					},
				})
			);
		} catch {}
		return;
	}

	await advanceTaskStatusByFileLine({ app, filePath, line0, sequence });
}

/**
 * Convenience: Set status for a "TaskItem-like" object to an explicit target.
 * Emits "agile:task-status-changed".
 */
export async function setTaskStatusForTaskItem(params: {
	app: App;
	task: { filePath: string; line0: number };
	to: StatusChar;
}): Promise<void> {
	const { app, task, to } = params;
	const { filePath, line0 } = task;
	if (!filePath || typeof line0 !== "number") return;

	const activeView = app.workspace.getActiveViewOfType(MarkdownView);
	const editor: Editor | null =
		activeView && activeView.file?.path === filePath
			? ((activeView as any).editor as Editor)
			: null;

	if (editor) {
		const res = setTaskStatusAtEditorLine(editor, line0, to);
		if (res.from == null) return;
		try {
			document.dispatchEvent(
				new CustomEvent("agile:task-status-changed" as any, {
					detail: {
						filePath,
						id: "",
						line0,
						fromStatus: res.from,
						toStatus: res.to,
					},
				})
			);
		} catch {}
		return;
	}

	await setTaskStatusByFileLine({ app, filePath, line0, to });
}

/**
 * Wire up editor-change handling so that clicking a checkbox in an open note
 * follows our custom circular sequence and supports long-press-to-cancel ("-").
 *
 * Updates:
 * - Long-press only applies on release (no mid-press mutations) → avoids flicker.
 * - We suppress the subsequent click to prevent Obsidian's default toggle.
 * - We only treat presses in the actual "[ ]" token as checkbox intent.
 */
export function wireTaskStatusSequence(app: App, plugin: Plugin) {
	// Per-view snapshots to diff line changes
	const viewSnapshots = new WeakMap<
		MarkdownView,
		{ path: string; lines: string[] }
	>();

	// Track a press in progress per view
	type PressState = {
		line0: number;
		filePath: string;
		timerId: number | null;
		longPressReady: boolean;
	};
	const pressState = new WeakMap<MarkdownView, PressState>();

	// After we apply a programmatic change for a press, ignore the very next editor-change
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

		// If we just performed a programmatic change due to a press, ignore this editor-change
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

		// Manual typing or programmatic changes not triggered by our press:
		// respect the user's resulting value and emit the event
		const last = transitions[transitions.length - 1];
		const before = normalizeStatusInput(last.before);
		const after = normalizeStatusInput(last.after);
		if (before || after) {
			try {
				document.dispatchEvent(
					new CustomEvent("agile:task-status-changed" as any, {
						detail: {
							filePath: path,
							id: "",
							line0: last.line0,
							fromStatus: before,
							toStatus: after,
						},
					})
				);
			} catch {}
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
				"[task-status-sequence] editor-change handler failed",
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

	// Pointer-based press handling (decide on release: short => advance, long => cancel)
	const onPointerDown = (evt: PointerEvent) => {
		try {
			const view = app.workspace.getActiveViewOfType(MarkdownView);
			if (!view || !view.file) return;
			const editor: any = (view as any).editor;
			if (!editor) return;

			const container: HTMLElement | null =
				(view as any).contentEl || (view as any).containerEl || null;
			if (!container || !container.contains(evt.target as Node)) return;

			// Must be on a checkbox token
			const pos = findPosFromEvent(editor, evt as any);
			if (!pos) return;
			const line0 = pos.line;
			const lineText = editor.getLine(line0) ?? "";
			if (!isPosOnCheckboxToken(lineText, pos.ch)) return;

			// Start a new press state (we don't mutate yet)
			// Do NOT preventDefault here—let CM handle cursor, but we will suppress click later.
			const filePath = view.file?.path || "";
			const existing = pressState.get(view);
			if (existing?.timerId != null) {
				window.clearTimeout(existing.timerId);
			}
			const state: PressState = {
				line0,
				filePath,
				timerId: null,
				longPressReady: false,
			};
			const timerId = window.setTimeout(() => {
				// Arm long-press; we will apply on release
				state.longPressReady = true;
				state.timerId = null;
			}, LONG_PRESS_CANCEL_MS);
			state.timerId = timerId as unknown as number;
			pressState.set(view, state);
		} catch {
			/* ignore */
		}
	};

	const finishPressIfAny = (ev?: Event) => {
		try {
			const view = app.workspace.getActiveViewOfType(MarkdownView);
			if (!view || !view.file) return;
			const editor: any = (view as any).editor;
			if (!editor) return;

			const state = pressState.get(view);
			if (!state) return;

			// Clear any pending timer
			if (state.timerId != null) {
				window.clearTimeout(state.timerId);
				state.timerId = null;
			}

			const path = state.filePath;
			const line0 = state.line0;
			const orig = editor.getLine(line0) ?? "";
			const from = getCheckboxStatusChar(orig);

			if (from == null) {
				pressState.delete(view);
				return;
			}

			// Apply either cancel ("-") or short-press advance on release
			let applied: {
				from: string | null;
				to: StatusChar | null;
				didChange: boolean;
			};
			if (state.longPressReady) {
				applied = setTaskStatusAtEditorLine(editor, line0, "-");
			} else {
				applied = advanceTaskStatusAtEditorLine(
					editor,
					line0,
					DEFAULT_STATUS_SEQUENCE
				);
			}

			// Update snapshot and emit event if we actually changed something
			if (applied.didChange && applied.to) {
				ignoreNextEditorChange.set(view, true);
				try {
					document.dispatchEvent(
						new CustomEvent("agile:task-status-changed" as any, {
							detail: {
								filePath: path,
								id: "",
								line0,
								fromStatus: applied.from,
								toStatus: applied.to,
							},
						})
					);
				} catch {}
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

			// Also prevent the default click if we have the event here (e.g., touchend bubbling)
			if (ev && "preventDefault" in ev) {
				try {
					(ev as any).preventDefault?.();
					(ev as any).stopPropagation?.();
					// @ts-ignore
					(ev as any).stopImmediatePropagation?.();
				} catch {}
			}
		} catch {
			/* ignore */
		}
	};

	const onPointerUpOrCancel = (evt: Event) => {
		finishPressIfAny(evt);
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

/**
 * Attach handlers to a custom view checkbox element to:
 * - Short press: advance by DEFAULT_STATUS_SEQUENCE
 * - Long press: set to "-" (cancel)
 *
 * Changes:
 * - Apply on release (no mid-press mutation) to avoid flicker.
 * - Suppress the click that follows the press we handled.
 */
export function attachCustomCheckboxStatusHandlers(opts: {
	checkboxEl: HTMLInputElement;
	app: App;
	task: {
		filePath: string;
		line0: number;
		status?: string | null | undefined;
	};
	longPressMs?: number;
	onStatusApplied?: (to: StatusChar) => void;
}) {
	const {
		checkboxEl,
		app,
		task,
		longPressMs = LONG_PRESS_CANCEL_MS,
		onStatusApplied,
	} = opts;

	let pressTimer: number | null = null;
	let longPressReady = false;
	let isUpdating = false;
	let suppressNextClick = false;

	// Manage the input's visual state (checked only for 'x')
	const setCheckedForStatus = (s: StatusChar | string) => {
		const checked = s === "x";
		checkboxEl.checked = checked;
	};

	const clearTimer = () => {
		if (pressTimer !== null) {
			window.clearTimeout(pressTimer);
			pressTimer = null;
		}
	};

	const performAdvance = async () => {
		if (isUpdating) return;
		isUpdating = true;
		try {
			const predicted = getNextStatusChar(
				task.status ?? " ",
				DEFAULT_STATUS_SEQUENCE
			);
			await advanceTaskStatusForTaskItem({ app, task });
			(task as any).status = predicted;
			setCheckedForStatus(predicted);
			onStatusApplied?.(predicted);
		} finally {
			isUpdating = false;
		}
	};

	const performCancel = async () => {
		if (isUpdating) return;
		isUpdating = true;
		try {
			await setTaskStatusForTaskItem({
				app,
				task: { filePath: task.filePath, line0: task.line0 },
				to: "-",
			});
			(task as any).status = "-";
			setCheckedForStatus("-");
			onStatusApplied?.("-");
		} finally {
			isUpdating = false;
		}
	};

	// Prevent default change; we'll manage state ourselves
	checkboxEl.addEventListener("change", (ev) => {
		ev.preventDefault();
		// @ts-ignore
		(ev as any).stopImmediatePropagation?.();
		// Keep current state until our handler decides
		setCheckedForStatus((task as any).status ?? " ");
	});

	// Keyboard support (Space/Enter => advance)
	checkboxEl.addEventListener("keydown", async (ev) => {
		const key = (ev as KeyboardEvent).key;
		if (key === " " || key === "Enter") {
			ev.preventDefault();
			ev.stopPropagation();
			await performAdvance();
		}
	});

	const onPressStart = () => {
		longPressReady = false;
		clearTimer();
		pressTimer = window.setTimeout(() => {
			longPressReady = true;
		}, longPressMs);
	};

	const onPressEnd = async (ev?: Event) => {
		clearTimer();
		// Apply on release
		if (longPressReady) {
			await performCancel();
		} else {
			await performAdvance();
		}
		// Swallow the immediate click
		suppressNextClick = true;
		if (ev) {
			try {
				ev.preventDefault();
				ev.stopPropagation();
				// @ts-ignore
				(ev as any).stopImmediatePropagation?.();
			} catch {}
		}
	};

	checkboxEl.addEventListener("pointerdown", onPressStart);
	checkboxEl.addEventListener("pointerup", onPressEnd);
	checkboxEl.addEventListener("pointercancel", () => {
		clearTimer();
	});

	// Fallback mouse/touch (in case PointerEvents are not available)
	checkboxEl.addEventListener("mousedown", onPressStart);
	checkboxEl.addEventListener("mouseup", onPressEnd);
	checkboxEl.addEventListener("mouseleave", () => clearTimer());
	checkboxEl.addEventListener("touchstart", onPressStart, {
		passive: true,
	} as any);
	checkboxEl.addEventListener("touchend", onPressEnd);
	checkboxEl.addEventListener("touchcancel", () => clearTimer());

	checkboxEl.addEventListener("click", (ev) => {
		// Suppress the click generated by our press handling
		if (suppressNextClick) {
			suppressNextClick = false;
			ev.preventDefault();
			ev.stopPropagation();
			// @ts-ignore
			(ev as any).stopImmediatePropagation?.();
			return;
		}
		// Otherwise, prevent default and let our handlers manage state
		ev.preventDefault();
		ev.stopPropagation();
	});
}
