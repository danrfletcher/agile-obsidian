import { MarkdownView } from "obsidian";
import type { Container } from "../container";
import { ProgressNotice } from "../ui/progress-notice";
import {
	createCanonicalFormatterService,
	createCanonicalFormatterOrchestrator,
} from "@features/task-canonical-formatter";
import type { CanonicalFormatterPort } from "@features/task-canonical-formatter";

/**
 * Wires canonical formatter for a specific MarkdownView.
 * Returns a disposer that tears down all listeners for this view.
 */
export function wireCanonicalFormatterForView(
	view: MarkdownView,
	container: Container
): () => void {
	const editor = view.editor;
	if (!editor) return () => void 0;

	// Mutation barrier to avoid re-entrancy from our own writes.
	let isMutating = false;

	let lastDocLineCount = editor.lineCount();
	let lastCursorLine = editor.getCursor().line;
	const progress = ProgressNotice.getOrCreateForView(view);
	const { app } = container;

	const getSettingsSnapshot = () => {
		try {
			const svc: any = container.settingsService as any;
			if (svc && typeof svc.getRaw === "function") return svc.getRaw();
			if (svc && typeof svc.get === "function") return svc.get();
		} catch {}
		return container.settings;
	};

	const getFlags = () => {
		const s: any = getSettingsSnapshot();
		return {
			master: !!s.enableTaskCanonicalFormatter,
			onLineCommit: !!s.enableCanonicalOnLineCommit,
			onLeafChange: !!s.enableCanonicalOnLeafChange,
		};
	};

	const port: CanonicalFormatterPort = {
		getCurrentLine: () => {
			const cursor = editor.getCursor();
			const lineNumber = cursor.line;
			const line = editor.getLine(lineNumber);
			if (typeof line !== "string") return null;
			const from = editor.getCursor("from");
			const to = editor.getCursor("to");
			const hasRange = from.line !== to.line || from.ch !== to.ch;
			let selection: { start: number; end: number } | undefined;
			if (
				hasRange &&
				from.line === lineNumber &&
				to.line === lineNumber
			) {
				selection = { start: from.ch, end: to.ch };
			} else if (!hasRange && cursor.line === lineNumber) {
				selection = { start: cursor.ch, end: cursor.ch };
			}
			return { line, lineNumber, selection };
		},
		getLineAt: (lineNumber: number) => {
			if (
				typeof lineNumber !== "number" ||
				lineNumber < 0 ||
				lineNumber >= editor.lineCount()
			) {
				return null;
			}
			const line = editor.getLine(lineNumber);
			return typeof line === "string" ? line : null;
		},
		replaceLineWithSelection: (lineNumber, newLine, newSel) => {
			const oldLine = editor.getLine(lineNumber);
			if (oldLine === newLine) return;
			isMutating = true;
			try {
				editor.replaceRange(
					newLine,
					{ line: lineNumber, ch: 0 },
					{ line: lineNumber, ch: oldLine.length }
				);
				editor.setSelection(
					{ line: lineNumber, ch: newSel.start },
					{ line: lineNumber, ch: newSel.end }
				);
			} finally {
				isMutating = false;
			}
		},
		replaceLine: (lineNumber, newLine) => {
			const oldLine = editor.getLine(lineNumber);
			if (oldLine === newLine) return;
			isMutating = true;
			try {
				editor.replaceRange(
					newLine,
					{ line: lineNumber, ch: 0 },
					{ line: lineNumber, ch: oldLine.length }
				);
			} finally {
				isMutating = false;
			}
		},
		replaceAllLines: (newLines: string[]) => {
			try {
				const current = editor.getValue();
				const eol = current.includes("\r\n") ? "\r\n" : "\n";
				const next = newLines.join(eol);
				if (next === current) return;

				const cur = editor.getCursor();
				isMutating = true;
				try {
					if (typeof (editor as any).setValue === "function") {
						(editor as any).setValue(next);
					} else {
						const lineCount = editor.lineCount();
						const lastLineLen =
							editor.getLine(lineCount - 1)?.length ?? 0;
						editor.replaceRange(
							next,
							{ line: 0, ch: 0 },
							{ line: lineCount - 1, ch: lastLineLen }
						);
					}
					const maxLine = Math.max(0, editor.lineCount() - 1);
					const line = Math.min(cur.line, maxLine);
					const lineLen = editor.getLine(line)?.length ?? 0;
					const ch = Math.max(0, Math.min(cur.ch, lineLen));
					if (typeof (editor as any).setCursor === "function") {
						(editor as any).setCursor({ line, ch });
					}
				} finally {
					isMutating = false;
				}
			} catch {
				// swallow
			}
		},
		getCursorLine: () => editor.getCursor().line,
		getAllLines: () => {
			const lc = editor.lineCount();
			const lines: string[] = [];
			for (let i = 0; i < lc; i++) lines.push(editor.getLine(i));
			return lines;
		},
		onProgressStart: ({ title, total }) => progress.start(title, total),
		onProgressUpdate: ({ current, total, message }) =>
			progress.update(current, total, message),
		onProgressEnd: () => progress.end(),

		onLineCommitted: (cb) => {
			let detachDom: (() => void) | null = null;

			const cmContent: HTMLElement | undefined = (editor as any)?.cm
				?.contentDOM;
			const queriedContent = view.containerEl.querySelector(
				".cm-content"
			) as HTMLElement | null;
			const el: HTMLElement | null =
				(cmContent ?? queriedContent) || null;

			const keyHandler = (ev: KeyboardEvent) => {
				if (isMutating) return;
				if (ev.key === "Enter" && !ev.isComposing) {
					const flags = getFlags();
					if (!flags.master || !flags.onLineCommit) return;
					cb();
				}
			};

			if (el && typeof el.addEventListener === "function") {
				el.addEventListener("keydown", keyHandler, true);
				detachDom = () =>
					el.removeEventListener("keydown", keyHandler, true);
			}

			const off = app.workspace.on("editor-change", (_maybeView) => {
				if (isMutating) return;
				const active = app.workspace.getActiveViewOfType(MarkdownView);
				if (active !== view) return;

				const currentCount = editor.lineCount();
				if (currentCount > lastDocLineCount) {
					const flags = getFlags();
					if (!flags.master || !flags.onLineCommit) {
						lastDocLineCount = currentCount;
						return;
					}
					cb();
				}
				lastDocLineCount = currentCount;
			});

			return () => {
				if (detachDom) {
					try {
						detachDom();
					} catch {}
				}
				app.workspace.offref(off);
			};
		},

		onCursorLineChanged: (cb) => {
			let detachFns: Array<() => void> = [];

			const cmContent: HTMLElement | undefined = (editor as any)?.cm
				?.contentDOM;
			const queriedContent = view.containerEl.querySelector(
				".cm-content"
			) as HTMLElement | null;
			const targetEl: HTMLElement | null =
				(cmContent ?? queriedContent) || null;

			let rafId: number | null = null;
			const scheduleNotify = () => {
				if (rafId != null) return;
				rafId = requestAnimationFrame(() => {
					rafId = null;
					notifyIfChanged();
				});
			};

			const notifyIfChanged = () => {
				if (isMutating) return;
				const active =
					container.app.workspace.getActiveViewOfType(MarkdownView);
				if (active !== view) return;

				const nextLine = editor.getCursor().line;
				if (nextLine !== lastCursorLine) {
					const prevLine = lastCursorLine;
					lastCursorLine = nextLine;
					const flags = getFlags();
					if (!flags.master || !flags.onLineCommit) return;
					try {
						cb({ prevLine, nextLine });
					} catch {}
				}
			};

			const selectionHandler = () => {
				try {
					const sel = document.getSelection();
					if (!sel || !sel.anchorNode) return;

					if (targetEl && targetEl.contains(sel.anchorNode)) {
						scheduleNotify();
					} else if (!targetEl) {
						const active =
							container.app.workspace.getActiveViewOfType(
								MarkdownView
							);
						if (active === view) scheduleNotify();
					}
				} catch {}
			};
			document.addEventListener(
				"selectionchange",
				selectionHandler,
				true
			);
			detachFns.push(() =>
				document.removeEventListener(
					"selectionchange",
					selectionHandler,
					true
				)
			);

			if (targetEl) {
				const pointerUp = () => scheduleNotify();
				const click = () => scheduleNotify();
				targetEl.addEventListener("pointerup", pointerUp, true);
				targetEl.addEventListener("click", click, true);
				detachFns.push(() =>
					targetEl.removeEventListener("pointerup", pointerUp, true)
				);
				detachFns.push(() =>
					targetEl.removeEventListener("click", click, true)
				);
			}

			if (targetEl) {
				const navKeyHandler = (ev: KeyboardEvent) => {
					if (isMutating) return;
					switch (ev.key) {
						case "ArrowUp":
						case "ArrowDown":
						case "PageUp":
						case "PageDown":
						case "Home":
						case "End":
							scheduleNotify();
							break;
					}
				};
				targetEl.addEventListener("keydown", navKeyHandler, true);
				detachFns.push(() =>
					targetEl.removeEventListener("keydown", navKeyHandler, true)
				);
			}

			const offEdit = container.app.workspace.on(
				"editor-change",
				(_maybeView) => {
					const active =
						container.app.workspace.getActiveViewOfType(
							MarkdownView
						);
					if (active !== view) return;
					scheduleNotify();
				}
			);
			detachFns.push(() => container.app.workspace.offref(offEdit));

			return () => {
				for (const off of detachFns) {
					try {
						off();
					} catch {}
				}
				if (rafId != null) {
					try {
						cancelAnimationFrame(rafId);
					} catch {}
					rafId = null;
				}
				detachFns = [];
			};
		},

		onLeafOrFileChanged: (cb) => {
			const off1 = app.workspace.on("active-leaf-change", (_leaf) => {
				if (isMutating) return;
				const active = app.workspace.getActiveViewOfType(MarkdownView);
				if (active === view) {
					const flags = getFlags();
					if (!flags.master || !flags.onLeafChange) return;
					cb();
				}
			});
			const off2 = app.workspace.on("file-open", (_file) => {
				if (isMutating) return;
				const active = app.workspace.getActiveViewOfType(MarkdownView);
				if (active === view) {
					const flags = getFlags();
					if (!flags.master || !flags.onLeafChange) return;
					cb();
				}
			});
			return () => {
				app.workspace.offref(off1);
				app.workspace.offref(off2);
			};
		},
	};

	const svc = createCanonicalFormatterService(port);
	const orchestrator = createCanonicalFormatterOrchestrator(svc, {
		port,
		debounceMs: 300,
		shouldRun: () => getFlags(),
	});
	(view as any).__canonicalProbe = () => {
		orchestrator.triggerOnceNow("manual", "line");
		// Optional: could log or notify here.
	};

	const flagsAtWire = getFlags();
	if (flagsAtWire.master && flagsAtWire.onLeafChange) {
		setTimeout(() => {
			const stillActive =
				container.app.workspace.getActiveViewOfType(MarkdownView) ===
				view;
			if (!stillActive) return;
			orchestrator.triggerOnceNow("leaf-or-file", "file");
		}, 0);
	}

	return () => {
		try {
			orchestrator.dispose();
		} catch {}
		const lingering = (ProgressNotice as any).activeForView?.get?.(view);
		if (lingering) {
			try {
				(lingering as any).end?.();
			} catch {}
		}
	};
}
