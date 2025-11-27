import { toYyyyMmDd } from "@features/task-date-manager";
import { getCheckboxStatusChar } from "@platform/obsidian";
import type {
	App,
	Editor,
	EditorPosition,
	MarkdownFileInfo,
	Plugin,
	TFile,
} from "obsidian";
import { MarkdownView, TFile as ObsidianTFile } from "obsidian";
import {
	appendEmojiWithDate,
	CANCELLED_EMOJI,
	COMPLETED_EMOJI,
	hasEmoji,
	removeEmoji,
} from "../domain/task-close-utils";
import {
	getNextStatusChar,
	DEFAULT_STATUS_SEQUENCE,
	type StatusChar,
} from "@features/task-status-sequencer";

// Explicit declarations for browser globals used in the Obsidian renderer
// environment. These are erased at runtime but satisfy ESLint's `no-undef`.
declare const document: Document;
declare const window: Window;
declare const console: Console;

/**
 * Task Close Manager
 * - Listens to:
 *   - editor-change for immediate, in-editor changes
 *   - agile:task-status-changed (emitted by task-status-sequence/headless) for non-editor changes
 * - Appends/removes ✅/❌ date markers according to status transitions to/from [x] and [-]
 *
 * Responsibility separation:
 * - This module DOES NOT change the checkbox status character.
 * - Status progression is handled entirely by @features/task-status-sequence.
 *
 * Notes on suppression and reliability:
 * - Suppression is used to avoid double-writing when the index re-parses after our edits.
 *
 * Cursor preservation:
 * - When we modify a line in the active editor, we preserve the user's cursor/selection if it was on
 *   that line, clamping to the new line length. This prevents the caret from jumping to column 0.
 */

function removeAllMarkers(line: string): string {
	let out = line;
	out = removeEmoji(out, COMPLETED_EMOJI);
	out = removeEmoji(out, CANCELLED_EMOJI);
	return out;
}

type Status = string | undefined | null;

type StatusChangedDetail = {
	filePath: string;
	id: string;
	line0: number;
	fromStatus: Status;
	toStatus: Status;
};

type DateAddedDetail = {
	filePath: string;
	parentLine0: number;
	date: string;
	beforeLines?: string[];
};

type SelectionRange = {
	from: EditorPosition;
	to: EditorPosition;
};

type MutateResult = {
	beforeLines: string[];
	didChange: boolean;
};

interface SelectionPreservingEditor extends Editor {
	getCursor(position?: "from" | "to"): EditorPosition;
}

function norm(s: Status): string {
	const v = (s ?? "").toString();
	return v.length ? v.toLowerCase() : "";
}

export function wireTaskCloseManager(app: App, plugin: Plugin) {
	// Short suppression for our own writes (by file path)
	const suppressedPaths = new Map<string, number>();
	const suppressPath = (path: string, ms: number) =>
		suppressedPaths.set(path, Date.now() + ms);
	const isSuppressed = (path: string) => {
		const until = suppressedPaths.get(path);
		if (!until) return false;
		if (Date.now() <= until) return true;
		suppressedPaths.delete(path);
		return false;
	};

	// Snapshots to detect immediate, in-editor transitions
	const viewSnapshots = new WeakMap<
		MarkdownView,
		{ path: string; lines: string[] }
	>();

	function emitDateAdded(
		kind: "completed" | "cancelled",
		filePath: string,
		parentLine0: number,
		date: string,
		beforeLines: string[] | null | undefined
	) {
		const evtName =
			kind === "completed"
				? "agile:task-completed-date-added"
				: "agile:task-cancelled-date-added";

		try {
			document.dispatchEvent(
				new CustomEvent<DateAddedDetail>(evtName, {
					detail: {
						filePath,
						parentLine0,
						date,
						beforeLines: beforeLines ?? undefined,
					},
				})
			);
		} catch (e) {
			console.warn("[task-close-manager] emit date-added failed", e);
		}
	}

	async function modifyInEditor(
		view: MarkdownView,
		line0: number,
		mutate: (orig: string) => string | null
	): Promise<MutateResult | null> {
		const editor = view.editor as SelectionPreservingEditor | null;
		if (!editor) return null;

		// Snapshot lines before edit
		const beforeLines: string[] = [];
		const lineCount = editor.lineCount();
		for (let i = 0; i < lineCount; i += 1) {
			beforeLines.push(editor.getLine(i));
		}

		// Snapshot cursor/selection to preserve user caret if it's on the edited line
		let selection: SelectionRange | null = null;
		try {
			const from = editor.getCursor("from");
			const to = editor.getCursor("to");
			if (
				typeof from?.line === "number" &&
				typeof from.ch === "number" &&
				typeof to?.line === "number" &&
				typeof to.ch === "number" &&
				(from.line === line0 || to.line === line0) &&
				from.line === to.line
			) {
				selection = { from, to };
			}
		} catch {
			selection = null;
		}

		const orig = editor.getLine(line0) ?? "";
		const updated = mutate(orig);
		if (updated == null || updated === orig)
			return { beforeLines, didChange: false };

		// Replace entire line
		editor.replaceRange(
			updated,
			{ line: line0, ch: 0 },
			{ line: line0, ch: orig.length }
		);

		// Restore selection/caret if it was on this line
		if (selection) {
			const { from, to } = selection;
			const newLen = updated.length;
			const newFromCh = Math.max(0, Math.min(newLen, from.ch));
			const newToCh = Math.max(0, Math.min(newLen, to.ch));

			if (newFromCh === newToCh) {
				editor.setCursor({ line: line0, ch: newFromCh });
			} else {
				editor.setSelection(
					{ line: line0, ch: newFromCh },
					{ line: line0, ch: newToCh }
				);
			}
		}

		return { beforeLines, didChange: true };
	}

	async function modifyHeadless(
		filePath: string,
		line0: number,
		mutate: (orig: string) => string | null
	): Promise<MutateResult | null> {
		const abs = app.vault.getAbstractFileByPath(filePath);
		if (!(abs instanceof ObsidianTFile)) return null;
		const tfile: TFile = abs;

		const content = await app.vault.read(tfile);
		const lines = content.split(/\r?\n/);
		const orig = lines[line0] ?? "";
		const updated = mutate(orig);
		if (updated == null || updated === orig) {
			return { beforeLines: lines.slice(), didChange: false };
		}

		try {
			window.dispatchEvent(
				new CustomEvent("agile:prepare-optimistic-file-change", {
					detail: { filePath },
				})
			);
		} catch {
			// ignore
		}
		lines[line0] = updated;
		// Suppress downstream index-driven re-writes for a short window
		if (!isSuppressed(filePath)) {
			suppressPath(filePath, 1200);
		}
		await app.vault.modify(tfile, lines.join("\n"));
		return { beforeLines: lines.slice(), didChange: true };
	}

	/**
	 * Compute desired next status according to our default circular sequence.
	 */
	function desiredNextStatus(prev: string | null | undefined): StatusChar {
		return getNextStatusChar(prev ?? " ", DEFAULT_STATUS_SEQUENCE);
	}

	// 1) Immediate path for open editor changes (never blocked by suppression)
	const detectTransitions = (
		prevLines: string[],
		nextLines: string[]
	): Array<{
		line0: number;
		before: string; // previous checkbox char
		after: string; // new checkbox char after user action (Obsidian default or manual edit)
		desired: StatusChar; // what we want according to our sequence
	}> => {
		const maxLen = Math.max(prevLines.length, nextLines.length);
		const changes: Array<{
			line0: number;
			before: string;
			after: string;
			desired: StatusChar;
		}> = [];
		let inspected = 0;

		for (let i = 0; i < maxLen; i++) {
			const beforeLine = prevLines[i] ?? "";
			const afterLine = nextLines[i] ?? "";
			if (beforeLine === afterLine) continue;

			const b = (getCheckboxStatusChar(beforeLine) ?? "").toLowerCase();
			const a = (getCheckboxStatusChar(afterLine) ?? "").toLowerCase();

			if (b === a) {
				if (++inspected > 500) break;
				continue;
			}

			const d = desiredNextStatus(b);
			changes.push({ line0: i, before: b, after: a, desired: d });

			if (++inspected > 500) break;
		}
		return changes;
	};

	const tryImmediateHandleForView = async (view: MarkdownView) => {
		const file = view.file;
		if (!file || file.extension !== "md") return;
		const path = file.path;

		const editor = view.editor as SelectionPreservingEditor | null;
		if (!editor) return;

		const nextLines: string[] = [];
		const count = editor.lineCount();
		for (let i = 0; i < count; i += 1) {
			nextLines.push(editor.getLine(i));
		}

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

		// Act on the most recent change
		const last = transitions[transitions.length - 1];
		const today = toYyyyMmDd(new Date());

		// Decide the resulting "kind" from our desired status (not Obsidian's)
		const desired = last.desired;
		const prev = last.before;

		type Kind = "toCompleted" | "toCancelled" | "reopened" | "none";

		// Only add/remove dates when the observed "after" matches our desired closed state,
		// or when the desired indicates a reopen from a closed state.
		let kind: Kind = "none";
		if (desired === "x" && last.after === "x") kind = "toCompleted";
		else if (desired === "-" && last.after === "-") kind = "toCancelled";
		else if (
			(prev === "x" || prev === "-") &&
			(desired === " " || desired === "/")
		)
			kind = "reopened";

		if (kind === "none") {
			// Do nothing; either not a closed transition, or Obsidian's default toggle
			// that will be corrected by task-status-sequence.
			viewSnapshots.set(view, { path, lines: nextLines });
			return;
		}

		const mutateForKind =
			(target: Kind) =>
			(orig: string): string | null => {
				// Ensure acting on a checkbox line
				const present = getCheckboxStatusChar(orig);
				if (present == null) return null;

				if (target === "toCompleted") {
					// Append ✅ date if not already present; do NOT change checkbox char here
					if (hasEmoji(orig, COMPLETED_EMOJI)) return null;
					let updated = removeEmoji(orig, CANCELLED_EMOJI);
					updated = removeEmoji(updated, COMPLETED_EMOJI);
					updated = appendEmojiWithDate(
						updated,
						COMPLETED_EMOJI,
						today
					);
					return updated;
				}
				if (target === "toCancelled") {
					if (hasEmoji(orig, CANCELLED_EMOJI)) return null;
					let updated = removeEmoji(orig, COMPLETED_EMOJI);
					updated = removeEmoji(updated, CANCELLED_EMOJI);
					updated = appendEmojiWithDate(
						updated,
						CANCELLED_EMOJI,
						today
					);
					return updated;
				}
				// Reopen: strip both markers (leave current char untouched)
				const cleaned = removeAllMarkers(orig);
				return cleaned === orig ? null : cleaned;
			};

		const result = await modifyInEditor(
			view,
			last.line0,
			mutateForKind(kind)
		);

		// Update snapshot from the editor after our write
		const refreshed: string[] = [];
		const lc = editor.lineCount();
		for (let i = 0; i < lc; i += 1) {
			refreshed.push(editor.getLine(i));
		}
		viewSnapshots.set(view, { path, lines: refreshed });

		// Emit events only if we actually added a date (completed/cancelled)
		if (
			result?.didChange &&
			(kind === "toCompleted" || kind === "toCancelled")
		) {
			// Suppress feedback loop for the upcoming file-level modify/index parse
			suppressPath(path, 1200);
			const kindOut = kind === "toCompleted" ? "completed" : "cancelled";
			emitDateAdded(kindOut, path, last.line0, today, result.beforeLines);
		}
	};

	// Robust editor-change handler for different Obsidian signatures
	// Signature: (editor: Editor, info: MarkdownView | MarkdownFileInfo)
	const onEditorChange = async (
		_editor: Editor,
		info: MarkdownView | MarkdownFileInfo
	): Promise<void> => {
		try {
			let mdView: MarkdownView | null = null;

			if (info instanceof MarkdownView) {
				// Normal case: Obsidian gave us the MarkdownView directly.
				mdView = info;
			} else {
				// Fallback: resolve the active MarkdownView from the workspace.
				mdView = app.workspace.getActiveViewOfType(MarkdownView) ?? null;
			}

			if (!mdView) return;

			await tryImmediateHandleForView(mdView);
		} catch (e) {
			console.warn("[task-close-manager] editor-change handler failed", e);
		}
	};

	// Wrapper to avoid passing an async function directly where a void return is expected.
	const handleEditorChange = (
		editor: Editor,
		info: MarkdownView | MarkdownFileInfo
	): void => {
		void onEditorChange(editor, info);
	};

	plugin.registerEvent(
		app.workspace.on("editor-change", handleEditorChange)
	);

	plugin.registerEvent(
		app.workspace.on("active-leaf-change", () => {
			try {
				const view = app.workspace.getActiveViewOfType(MarkdownView);
				if (!view || !view.file) return;
				const editor =
					view.editor as SelectionPreservingEditor | null;
				if (!editor) return;
				const lines: string[] = [];
				const lineCount = editor.lineCount();
				for (let i = 0; i < lineCount; i += 1) {
					lines.push(editor.getLine(i));
				}
				viewSnapshots.set(view, { path: view.file.path, lines });
			} catch {
				// ignore
			}
		})
	);

	plugin.registerEvent(
		app.workspace.on("file-open", () => {
			try {
				const view = app.workspace.getActiveViewOfType(MarkdownView);
				if (!view || !view.file) return;
				const editor =
					view.editor as SelectionPreservingEditor | null;
				if (!editor) return;
				const lines: string[] = [];
				const lineCount = editor.lineCount();
				for (let i = 0; i < lineCount; i += 1) {
					lines.push(editor.getLine(i));
				}
				viewSnapshots.set(view, { path: view.file.path, lines });
			} catch {
				// ignore
			}
		})
	);

	// 2) Event-driven path from task-status-sequence for headless/non-editor changes
	const onStatusChanged = async (
		e: CustomEvent<StatusChangedDetail>
	): Promise<void> => {
		const detail = e.detail;
		if (!detail) return;

		const filePath = detail.filePath;
		const to = norm(detail.toStatus);
		const line0 = detail.line0;
		const today = toYyyyMmDd(new Date());

		// Suppress only when transitioning TO closed states (x or -).
		// Allow reopen events to pass even during suppression so the date never "sticks".
		if (isSuppressed(filePath) && (to === "x" || to === "-")) {
			return;
		}

		const mutateForTo =
			(toStatus: string) =>
			(orig: string): string | null => {
				const present = getCheckboxStatusChar(orig);
				if (present == null) return null;

				if (toStatus === "x") {
					if (hasEmoji(orig, COMPLETED_EMOJI)) return null;
					let updated = removeEmoji(orig, CANCELLED_EMOJI);
					updated = removeEmoji(updated, COMPLETED_EMOJI);
					updated = appendEmojiWithDate(
						updated,
						COMPLETED_EMOJI,
						today
					);
					return updated;
				}
				if (toStatus === "-") {
					if (hasEmoji(orig, CANCELLED_EMOJI)) return null;
					let updated = removeEmoji(orig, COMPLETED_EMOJI);
					updated = removeEmoji(updated, CANCELLED_EMOJI);
					updated = appendEmojiWithDate(
						updated,
						CANCELLED_EMOJI,
						today
					);
					return updated;
				}
				// Support non-closed states from status sequence ("/" and " ") and generic reopen:
				const cleaned = removeAllMarkers(orig);
				return cleaned === orig ? null : cleaned;
			};

		const activeView =
			app.workspace.getActiveViewOfType(MarkdownView);
		let result: MutateResult | null = null;

		if (
			activeView &&
			activeView.file &&
			activeView.file.path === filePath
		) {
			result = await modifyInEditor(activeView, line0, mutateForTo(to));
			// Refresh snapshot if this view is tracked
			const editor =
				activeView.editor as SelectionPreservingEditor | null;
			if (editor) {
				const refreshed: string[] = [];
				const lc = editor.lineCount();
				for (let i = 0; i < lc; i += 1) {
					refreshed.push(editor.getLine(i));
				}
				viewSnapshots.set(activeView, {
					path: filePath,
					lines: refreshed,
				});
			}
		} else {
			result = await modifyHeadless(filePath, line0, mutateForTo(to));
		}

		// Emit "date-added" events only when date was actually added
		if (result?.didChange && (to === "x" || to === "-")) {
			// Suppress downstream duplicate handling for a short window
			suppressPath(filePath, 1200);
			const kind = to === "x" ? "completed" : "cancelled";
			emitDateAdded(kind, filePath, line0, today, result.beforeLines);
		}
	};

	plugin.registerDomEvent(
		document,
		"agile:task-status-changed" as keyof DocumentEventMap,
		(event: Event) => {
			if (event instanceof CustomEvent) {
				void onStatusChanged(
					event as CustomEvent<StatusChangedDetail>
				);
			}
		}
	);
}