import { toYyyyMmDd } from "@features/task-date-manager";
import { getCheckboxStatusChar, isTaskLine } from "@platform/obsidian";
import type { App, Plugin, TFile } from "obsidian";
import { MarkdownView, TFile as ObsidianTFile } from "obsidian";
import {
	appendEmojiWithDate,
	CANCELLED_EMOJI,
	COMPLETED_EMOJI,
	hasEmoji,
	removeEmoji,
	setCheckboxStatusChar,
} from "../domain/task-close-utils";

/**
 * Task Close Manager
 * - Listens to:
 *   - agile:task-status-changed (emitted by task-index) for headless/non-editor changes
 *   - editor-change for immediate, in-editor changes
 * - Appends/removes ✅/❌ date markers according to status transitions
 * - Emits:
 *   - agile:task-completed-date-added
 *   - agile:task-cancelled-date-added
 *
 * Notes on suppression and reliability:
 * - Suppression is used to avoid double-writing when the index re-parses after our edits.
 * - We DO NOT suppress the immediate editor-change path so user toggles are always handled instantly.
 * - We DO suppress handling of 'to x'/'to -' events from the index (to avoid duplicates),
 *   but we allow 'reopen' (to neither x nor -) events even during suppression, so that reopening
 *   right after completion/cancellation reliably removes the date.
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
				new CustomEvent(evtName as any, {
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
	): Promise<{ beforeLines: string[]; didChange: boolean } | null> {
		const editor: any = (view as any).editor;
		if (!editor) return null;

		// Snapshot lines before edit
		const beforeLines: string[] = [];
		for (let i = 0; i < editor.lineCount(); i++)
			beforeLines.push(editor.getLine(i));

		// Snapshot cursor/selection to preserve user caret if it's on the edited line
		let from = editor.getCursor?.("from");
		let to = editor.getCursor?.("to");
		const hasCursorAPI =
			from &&
			to &&
			typeof from.line === "number" &&
			typeof from.ch === "number" &&
			typeof to.line === "number" &&
			typeof to.ch === "number";
		const selectionOnLine =
			hasCursorAPI &&
			(from.line === line0 || to.line === line0) &&
			// Only attempt to restore if selection is entirely within the same line (common typing case)
			from.line === to.line;

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
		if (selectionOnLine) {
			try {
				// Clamp to the new line length
				const newLen = updated.length;
				const newFromCh = Math.max(
					0,
					Math.min(newLen, from.ch as number)
				);
				const newToCh = Math.max(0, Math.min(newLen, to.ch as number));

				if (typeof editor.setSelection === "function") {
					editor.setSelection(
						{ line: line0, ch: newFromCh },
						{ line: line0, ch: newToCh }
					);
				} else if (
					newFromCh === newToCh &&
					typeof editor.setCursor === "function"
				) {
					editor.setCursor({ line: line0, ch: newFromCh });
				}
			} catch {
				// Non-fatal: if we cannot restore, we do nothing
			}
		}

		return { beforeLines, didChange: true };
	}

	async function modifyHeadless(
		filePath: string,
		line0: number,
		mutate: (orig: string) => string | null
	): Promise<{ beforeLines: string[]; didChange: boolean } | null> {
		const abs = app.vault.getAbstractFileByPath(filePath);
		if (!(abs instanceof ObsidianTFile)) return null;
		const tfile = abs as TFile;

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
		} catch {}
		lines[line0] = updated;
		// Suppress downstream index-driven re-writes for a short window
		if (!isSuppressed(filePath)) {
			suppressPath(filePath, 1200);
		}
		await app.vault.modify(tfile, lines.join("\n"));
		return { beforeLines: lines.slice(), didChange: true };
	}

	// 1) Immediate path for open editor changes (never blocked by suppression)
	const detectTransitions = (
		prevLines: string[],
		nextLines: string[]
	): Array<{
		line0: number;
		kind: "toCompleted" | "toCancelled" | "reopened";
	}> => {
		const maxLen = Math.max(prevLines.length, nextLines.length);
		const changes: Array<{
			line0: number;
			kind: "toCompleted" | "toCancelled" | "reopened";
		}> = [];
		let inspected = 0;

		for (let i = 0; i < maxLen; i++) {
			const before = prevLines[i] ?? "";
			const after = nextLines[i] ?? "";
			if (before === after) continue;

			// Only consider checkbox task lines
			const wasTask = isTaskLine(before);
			const isTask = isTaskLine(after);
			if (!wasTask && !isTask) {
				if (++inspected > 500) break;
				continue;
			}

			const b = (getCheckboxStatusChar(before) ?? "").toLowerCase();
			const a = (getCheckboxStatusChar(after) ?? "").toLowerCase();

			if (b === a) {
				if (++inspected > 500) break;
				continue;
			}

			if (a === "x") {
				changes.push({ line0: i, kind: "toCompleted" });
			} else if (a === "-") {
				changes.push({ line0: i, kind: "toCancelled" });
			} else if (b === "x" || b === "-") {
				changes.push({ line0: i, kind: "reopened" });
			}

			if (++inspected > 500) break;
		}
		return changes;
	};

	const tryImmediateHandleForView = async (view: MarkdownView) => {
		const file = view.file;
		if (!file || file.extension !== "md") return;
		const path = file.path;

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

		// Act on the most recent change
		const last = transitions[transitions.length - 1];
		const today = toYyyyMmDd(new Date());

		const mutateForKind =
			(kind: "toCompleted" | "toCancelled" | "reopened") =>
			(orig: string): string | null => {
				// Ensure acting on a checkbox line
				const present = getCheckboxStatusChar(orig);
				if (present == null) return null;

				if (kind === "toCompleted") {
					// Append ✅ date if not already present; normalize checkbox to [x]
					if (hasEmoji(orig, COMPLETED_EMOJI)) return null;
					let updated = setCheckboxStatusChar(orig, "x");
					updated = removeEmoji(updated, CANCELLED_EMOJI);
					updated = removeEmoji(updated, COMPLETED_EMOJI);
					updated = appendEmojiWithDate(
						updated,
						COMPLETED_EMOJI,
						today
					);
					return updated;
				}
				if (kind === "toCancelled") {
					if (hasEmoji(orig, CANCELLED_EMOJI)) return null;
					let updated = setCheckboxStatusChar(orig, "-");
					updated = removeEmoji(updated, COMPLETED_EMOJI);
					updated = removeEmoji(updated, CANCELLED_EMOJI);
					updated = appendEmojiWithDate(
						updated,
						CANCELLED_EMOJI,
						today
					);
					return updated;
				}
				// Reopen: strip both markers
				const cleaned = removeAllMarkers(orig);
				return cleaned === orig ? null : cleaned;
			};

		const result = await modifyInEditor(
			view,
			last.line0,
			mutateForKind(last.kind)
		);

		// Update snapshot from the editor after our write
		const refreshed: string[] = [];
		const lc = editor.lineCount();
		for (let i = 0; i < lc; i++) refreshed.push(editor.getLine(i));
		viewSnapshots.set(view, { path, lines: refreshed });

		// Emit events only if we actually added a date (not on reopen)
		if (
			result?.didChange &&
			(last.kind === "toCompleted" || last.kind === "toCancelled")
		) {
			// Suppress feedback loop for the upcoming file-level modify/index parse
			suppressPath(path, 1200);
			const kind =
				last.kind === "toCompleted" ? "completed" : "cancelled";
			emitDateAdded(kind, path, last.line0, today, result.beforeLines);
		}
	};

	// Robust editor-change handler for different Obsidian signatures
	const onEditorChangeAny = async (...args: any[]) => {
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
			await tryImmediateHandleForView(mdView);
		} catch (e) {
			console.warn(
				"[task-close-manager] editor-change handler failed",
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
				const lines: string[] = [];
				for (let i = 0; i < editor.lineCount(); i++)
					lines.push(editor.getLine(i));
				viewSnapshots.set(view, { path: view.file.path, lines });
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
			} catch {}
		})
	);

	// 2) Event-driven path from task-index for headless/non-editor changes
	const onStatusChanged = async (e: Event) => {
		const ce = e as CustomEvent<StatusChangedDetail>;
		const detail = ce?.detail;
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
					let updated = setCheckboxStatusChar(orig, "x");
					updated = removeEmoji(updated, CANCELLED_EMOJI);
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
					let updated = setCheckboxStatusChar(orig, "-");
					updated = removeEmoji(updated, COMPLETED_EMOJI);
					updated = removeEmoji(updated, CANCELLED_EMOJI);
					updated = appendEmojiWithDate(
						updated,
						CANCELLED_EMOJI,
						today
					);
					return updated;
				}
				// Reopen
				const cleaned = removeAllMarkers(orig);
				return cleaned === orig ? null : cleaned;
			};

		const activeView = app.workspace.getActiveViewOfType(MarkdownView);
		let result: { beforeLines: string[]; didChange: boolean } | null = null;

		if (
			activeView &&
			activeView.file &&
			activeView.file.path === filePath
		) {
			result = await modifyInEditor(activeView, line0, mutateForTo(to));
			// Refresh snapshot if this view is tracked
			const snap = viewSnapshots.get(activeView);
			if (snap && snap.path === filePath) {
				const editor: any = (activeView as any).editor;
				if (editor) {
					const refreshed: string[] = [];
					const lc = editor.lineCount();
					for (let i = 0; i < lc; i++)
						refreshed.push(editor.getLine(i));
					viewSnapshots.set(activeView, {
						path: filePath,
						lines: refreshed,
					});
				}
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
		"agile:task-status-changed" as any,
		onStatusChanged as any
	);
}
