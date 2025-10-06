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

/**
 * Normalize a status-like input into a canonical single-char string.
 * - Treats "" (empty) as " " (unchecked) so that sequence advances to "/".
 * - Downcases "X" to "x".
 */
function normalizeStatusInput(current: string | null | undefined): string {
	const s = (current ?? "").toString().toLowerCase();
	if (s === "" || s === " ") return " ";
	if (s === "x" || s === "-" || s === "/") return s;
	// Any other single-char custom code (e.g. "c") stays as-is for eventing,
	// but when computing "next" for clicks we will treat unknowns as " ".
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
	if (idx < 0) return sequence[0]; // treat unknown/custom as " "
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
	if (present == null) return line; // not a checkbox line
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
 * Compute a line number from a mouse or keyboard-triggered event relative to a checkbox element.
 * - For mouse/pointer events: uses clientX/clientY via CodeMirror posAtCoords.
 * - For keyboard events: uses the target element's center point as a proxy.
 */
export function findLineFromEvent(
	editor: Editor,
	evt: MouseEvent | KeyboardEvent
): number {
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
			if (pos && typeof pos.line === "number") {
				return pos.line;
			}
		}
	} catch {
		// ignore
	}

	// Fallback: cursor line
	return editor.getCursor().line ?? 0;
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
 * This function performs the status write itself, then dispatches
 * "agile:task-status-changed" so other modules (e.g., task-close-manager) can react.
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
 * Convenience: Advance status for a "TaskItem-like" object.
 * If task.status is provided, the next status is computed from it.
 * Otherwise, we read the file to determine the current status.
 *
 * Minimal expected shape:
 *   { filePath: string; line0: number; status?: string }
 *
 * This function performs the status write itself, then dispatches
 * "agile:task-status-changed".
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

	// If the file is open in the active editor, update there for immediate UX
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
		// Emit so listeners (e.g., task-close-manager) can react to closed/reopen
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

	// Fallback: modify the file off-editor
	await advanceTaskStatusByFileLine({ app, filePath, line0, sequence });
}

/**
 * Wire up editor-change handling so that clicking a checkbox in an open note
 * follows our custom circular sequence. This module writes the checkbox status
 * immediately, then emits "agile:task-status-changed" for downstream consumers.
 *
 * IMPORTANT:
 * - Overrides Obsidian's default toggle (" " ↔ "x") AND also overrides toggles
 *   from custom states (e.g., "/" or "-") when the change was initiated by a click.
 * - Allows MANUAL TYPING of any custom code inside [ ] (e.g., - [c]) without reverting it.
 *   Only click-driven toggles are overridden.
 */
export function wireTaskStatusSequence(app: App, plugin: Plugin) {
	// Track per-view snapshots to diff line changes
	const viewSnapshots = new WeakMap<
		MarkdownView,
		{ path: string; lines: string[] }
	>();

	// Track recent click intent per-view to disambiguate clicks vs manual typing
	const recentClick = new WeakMap<
		MarkdownView,
		{ line0: number; ts: number }
	>();
	const CLICK_INTENT_MS = 600;

	const collectLines = (editor: Editor): string[] => {
		const out: string[] = [];
		const count = editor.lineCount();
		for (let i = 0; i < count; i++) out.push(editor.getLine(i));
		return out;
	};

	const detectTransitions = (
		prevLines: string[],
		nextLines: string[]
	): Array<{
		line0: number;
		before: string; // raw previous checkbox char ('' if none/space)
		after: string; // raw new checkbox char
	}> => {
		const maxLen = Math.max(prevLines.length, nextLines.length);
		const changes: Array<{
			line0: number;
			before: string;
			after: string;
		}> = [];
		let inspected = 0;

		for (let i = 0; i < maxLen; i++) {
			const beforeLine = prevLines[i] ?? "";
			const afterLine = nextLines[i] ?? "";
			if (beforeLine === afterLine) continue;

			// Use raw chars for detection; '' means unchecked/space or not a checkbox.
			const bRaw = (getCheckboxStatusChar(beforeLine) ?? "")
				.toString()
				.toLowerCase();
			const aRaw = (getCheckboxStatusChar(afterLine) ?? "")
				.toString()
				.toLowerCase();

			// Only care when checkbox char actually changed between snapshots
			if (bRaw === aRaw) {
				if (++inspected > 500) break;
				continue;
			}
			// Only consider if at least one side is a checkbox line
			if (!bRaw && !aRaw) {
				if (++inspected > 500) break;
				continue;
			}
			changes.push({ line0: i, before: bRaw, after: aRaw });

			if (++inspected > 500) break;
		}
		return changes;
	};

	const applyDesiredToEditor = (
		editor: Editor,
		line0: number,
		desired: StatusChar
	): { didChange: boolean; from: string | null } => {
		const orig = editor.getLine(line0) ?? "";
		const from = getCheckboxStatusChar(orig);
		if (from == null) return { didChange: false, from };
		const updated = setCheckboxStatusChar(orig, desired);
		if (updated === orig) return { didChange: false, from };
		// Preserve cursor if on the same line
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

		return { didChange: true, from };
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
		const prevLines = snap.lines;
		const transitions = detectTransitions(prevLines, nextLines);
		if (transitions.length === 0) {
			viewSnapshots.set(view, { path, lines: nextLines });
			return;
		}

		// If we have a recent click intent on this view, try to enforce sequence there.
		const intent = recentClick.get(view);
		const now = Date.now();
		if (intent && now - intent.ts <= CLICK_INTENT_MS) {
			const match = transitions.find((t) => t.line0 === intent.line0);
			if (match) {
				// Canonicalize chars
				const before = normalizeStatusInput(match.before);
				const after = normalizeStatusInput(match.after);
				const desired = getNextStatusChar(
					before ?? " ",
					DEFAULT_STATUS_SEQUENCE
				);

				// If already at desired (e.g. user typed quickly), emit and move on.
				if (after === desired) {
					try {
						document.dispatchEvent(
							new CustomEvent(
								"agile:task-status-changed" as any,
								{
									detail: {
										filePath: path,
										id: "",
										line0: match.line0,
										fromStatus: before,
										toStatus: desired,
									},
								}
							)
						);
					} catch {}
					viewSnapshots.set(view, { path, lines: nextLines });
				} else {
					// Enforce our desired next state for click-driven change, regardless of what Obsidian toggled to.
					const changed = applyDesiredToEditor(
						editor,
						match.line0,
						desired
					);

					// Refresh snapshot post-write to prevent loops
					const refreshed = collectLines(editor);
					viewSnapshots.set(view, { path, lines: refreshed });

					// Emit event for downstream consumers
					try {
						document.dispatchEvent(
							new CustomEvent(
								"agile:task-status-changed" as any,
								{
									detail: {
										filePath: path,
										id: "",
										line0: match.line0,
										fromStatus: changed.from,
										toStatus: desired,
									},
								}
							)
						);
					} catch {}
				}
				// Clear this intent so it doesn't apply twice
				recentClick.delete(view);
				return;
			}
			// If no matching transition for the intended line, fall through to generic handling.
		}

		// Generic handling (manual typing, programmatic changes, or non-intended lines)
		// Act on the most recent change only
		const last = transitions[transitions.length - 1];
		const beforeRaw = last.before; // '' possible for " "
		const afterRaw = last.after;

		// Canonical for logic: map '' → ' '
		const before = normalizeStatusInput(beforeRaw);
		const after = normalizeStatusInput(afterRaw);

		// If we cannot determine anything useful, bail
		if (!before && !after) {
			viewSnapshots.set(view, { path, lines: nextLines });
			return;
		}

		// Compute desired from "before" (i.e., what the next char should be)
		const desired = getNextStatusChar(
			before ?? " ",
			DEFAULT_STATUS_SEQUENCE
		);

		// Supported set for sequence-managed states
		const SUPPORTED = new Set<StatusChar>([" ", "/", "x", "-"]);
		const afterIsSupported = SUPPORTED.has(after as StatusChar);

		// Click-driven default toggle detection used to be here,
		// but we now rely on recentClick to decide intent. Without a recent click,
		// we treat as manual typing and respect the user's value.
		if (afterIsSupported && after === desired) {
			// Already at desired; emit event for downstream consumers
			try {
				document.dispatchEvent(
					new CustomEvent("agile:task-status-changed" as any, {
						detail: {
							filePath: path,
							id: "",
							line0: last.line0,
							fromStatus: before,
							toStatus: desired,
						},
					})
				);
			} catch {}
			viewSnapshots.set(view, { path, lines: nextLines });
			return;
		}

		// Respect manual typing (including unsupported custom codes like "c")
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

		// Update snapshot
		viewSnapshots.set(view, { path, lines: nextLines });
	};

	// Robust editor-change handler for different Obsidian signatures
	const onEditorChangeAny = (...args: any[]) => {
		try {
			let mdView: any = null;
			// Possible signatures: (mdView), (_editor, mdView)
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

	// Capture click intent inside the active MarkdownView so we can distinguish clicks from typing.
	const onPointerDown = (evt: PointerEvent | MouseEvent) => {
		try {
			const view = app.workspace.getActiveViewOfType(MarkdownView);
			if (!view || !view.file) return;
			const editor: any = (view as any).editor;
			if (!editor) return;
			// Only if the event originated inside this view
			const container: HTMLElement | null =
				(view as any).contentEl || (view as any).containerEl || null;
			if (!container || !container.contains(evt.target as Node)) return;

			const line0 = findLineFromEvent(editor, evt as any);
			if (typeof line0 !== "number") return;

			// Optional: ensure the target line is a checkbox; lightweight check
			const lineText = editor.getLine(line0) ?? "";
			if (getCheckboxStatusChar(lineText) == null) return;

			recentClick.set(view, { line0, ts: Date.now() });
		} catch {
			/* ignore */
		}
	};

	plugin.registerDomEvent(document, "pointerdown", onPointerDown as any);
	plugin.registerDomEvent(document, "mousedown", onPointerDown as any);
}
