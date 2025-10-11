import type { TAbstractFile, TFile, Notice } from "obsidian";
import { MarkdownView, Notice as ObsidianNotice } from "obsidian";
import type { Container } from "./container";
import {
	createTaskIndexService,
	createTaskIndexOrchestrator,
} from "@features/task-index";
import { createObsidianAppAdapter } from "@platform/obsidian";
import type { TaskIndexPort } from "@features/templating-engine";
import { wireTemplatingDomHandlers } from "@features/templating-engine";
import { wireTemplatingUxShortcutsDomHandlers } from "@features/templating-ux-shortcuts";
import {
	createOrgStructureService,
	type OrgStructurePort,
} from "@features/org-structure";
import {
	wireTaskAssignmentDomHandlers,
	registerTaskAssignmentDynamicCommands,
} from "@features/task-assignment";

import {
	createCanonicalFormatterService,
	createCanonicalFormatterOrchestrator,
	normalizeTaskLine,
} from "@features/task-canonical-formatter";
import type { CanonicalFormatterPort } from "@features/task-canonical-formatter";

import { wireTaskAssignmentCascade } from "@features/task-assignment-cascade";
import { wireTaskClosedCascade } from "@features/task-close-cascade";
import { registerTaskMetadataCleanup } from "@features/task-metadata-cleanup";
import { wireTaskCloseManager } from "@features/task-close-manager";
import { wireTaskStatusSequence } from "@features/task-status-sequencer";

// Strong singleton-per-run progress UI (per view)
class ProgressNotice {
	private static activeForView = new WeakMap<MarkdownView, ProgressNotice>();
	static getOrCreateForView(view: MarkdownView): ProgressNotice {
		const existing = ProgressNotice.activeForView.get(view);
		if (existing) return existing;
		const created = new ProgressNotice(view);
		ProgressNotice.activeForView.set(view, created);
		return created;
	}
	private view: MarkdownView;
	private notice: Notice | null = null;
	private wrapper: HTMLDivElement | null = null;
	private bar: HTMLDivElement | null = null;
	private label: HTMLDivElement | null = null;
	private started = false;
	private ended = false;
	private rafId: number | null = null;
	private pendingPct: number = 0;
	private pendingText: string = "";
	private constructor(view: MarkdownView) {
		this.view = view;
	}
	private ensureElements(title: string) {
		if (this.notice && this.wrapper && this.bar && this.label) return;
		this.notice = new ObsidianNotice("", 0);
		const wrapper = document.createElement("div");
		wrapper.style.minWidth = "260px";
		wrapper.style.maxWidth = "360px";
		wrapper.style.display = "flex";
		wrapper.style.flexDirection = "column";
		wrapper.style.gap = "8px";
		const titleEl = document.createElement("div");
		titleEl.textContent = title;
		titleEl.style.fontWeight = "600";
		titleEl.style.fontSize = "12px";
		wrapper.appendChild(titleEl);
		const barOuter = document.createElement("div");
		barOuter.style.height = "6px";
		barOuter.style.background = "var(--background-modifier-border)";
		barOuter.style.borderRadius = "3px";
		barOuter.style.overflow = "hidden";
		const barInner = document.createElement("div");
		barInner.style.height = "100%";
		barInner.style.width = "0%";
		barInner.style.background = "var(--interactive-accent)";
		barInner.style.transition = "width 140ms linear";
		barOuter.appendChild(barInner);
		const label = document.createElement("div");
		label.style.fontSize = "11px";
		label.style.opacity = "0.8";
		wrapper.appendChild(barOuter);
		wrapper.appendChild(label);
		(this.notice as any).noticeEl?.empty?.();
		(this.notice as any).noticeEl?.appendChild(wrapper);
		this.wrapper = wrapper;
		this.bar = barInner;
		this.label = label;
	}
	private schedulePaint() {
		if (this.rafId != null) return;
		this.rafId = requestAnimationFrame(() => {
			this.rafId = null;
			if (this.bar) this.bar.style.width = `${this.pendingPct}%`;
			if (this.label) this.label.textContent = this.pendingText;
		});
	}
	start(title: string, total: number) {
		if (this.ended) return;
		if (this.started) return;
		this.started = true;
		this.ensureElements(title);
		this.pendingPct = 0;
		this.pendingText = `0 / ${Math.max(0, total)}`;
		this.schedulePaint();
	}
	update(current: number, total: number, message?: string) {
		if (!this.started || this.ended) return;
		const clampedTotal = Math.max(1, total);
		const clampedCur = Math.max(0, Math.min(current, clampedTotal));
		const pct = Math.floor((clampedCur / clampedTotal) * 100);
		this.pendingPct = pct;
		this.pendingText =
			message ?? `${clampedCur} / ${clampedTotal} (${pct}%)`;
		this.schedulePaint();
	}
	end() {
		if (this.ended) return;
		this.ended = true;
		if (this.notice) this.notice.hide();
		this.cleanup();
	}
	private cleanup() {
		if (this.rafId != null) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
		this.notice = null;
		this.wrapper = null;
		this.bar = null;
		this.label = null;
		this.started = false;
		ProgressNotice.activeForView.delete(this.view);
	}
}

export async function registerEvents(container: Container) {
	const { plugin, app } = container;
	const appAdapter = createObsidianAppAdapter(app);

	// Task index setup
	const taskIndexService = createTaskIndexService({ appAdapter });
	const taskIndexOrchestrator = createTaskIndexOrchestrator(taskIndexService);
	container.taskIndexService = taskIndexService;
	await taskIndexOrchestrator.buildAll();

	const asFile = (f: TAbstractFile | null): f is TFile =>
		!!f && (f as TFile).extension !== undefined;

	plugin.registerEvent(
		app.vault.on("create", async (file) => {
			if (asFile(file) && file.extension === "md") {
				await taskIndexOrchestrator.onFileCreated(file);
			}
		})
	);
	plugin.registerEvent(
		app.vault.on("modify", async (file) => {
			if (asFile(file) && file.extension === "md") {
				await taskIndexOrchestrator.onFileModified(file);
			}
		})
	);
	plugin.registerEvent(
		app.vault.on("delete", async (abstractFile) => {
			if (asFile(abstractFile)) {
				taskIndexOrchestrator.onFileDeleted(abstractFile.path);
			}
		})
	);
	plugin.registerEvent(
		app.vault.on("rename", async (file, oldPath) => {
			if (asFile(file)) {
				await taskIndexOrchestrator.onFileRenamed(oldPath, file.path);
			}
		})
	);

	// Ports for templating
	const templatingPorts: { taskIndex: TaskIndexPort } = {
		taskIndex: {
			getItemAtCursor: (cursor) =>
				taskIndexService.getItemAtCursor(cursor),
			getTaskByBlockRef: (ref) =>
				taskIndexService.getTaskByBlockRef(ref) as any,
		},
	};
	(container as any).templatingPorts = templatingPorts;

	// Canonical formatter per-view
	const canonicalOrchestrators = new WeakMap<
		MarkdownView,
		ReturnType<typeof createCanonicalFormatterOrchestrator>
	>();

	let currentView: MarkdownView | null = null;

	const unwireCanonicalFormatter = (view: MarkdownView | null) => {
		if (!view) return;
		const orch = canonicalOrchestrators.get(view);
		if (orch) {
			try {
				orch.dispose();
			} catch {}
			canonicalOrchestrators.delete(view);
		}
		const lingering = (ProgressNotice as any).activeForView?.get?.(view);
		if (lingering) {
			try {
				(lingering as any).end?.();
			} catch {}
		}
	};

	const wireCanonicalFormatter = (view: MarkdownView | null) => {
		if (!view) return;
		// Prevent duplicate subscriptions: always unwire existing for this view first
		if (canonicalOrchestrators.has(view)) {
			unwireCanonicalFormatter(view);
		}

		try {
			const editor = view.editor;
			if (!editor) return;

			// Mutation barrier to avoid re-entrancy from our own writes.
			let isMutating = false;

			let lastDocLineCount = editor.lineCount();
			let lastCursorLine = editor.getCursor().line;
			const progress = ProgressNotice.getOrCreateForView(view);

			// Always fetch the freshest settings snapshot
			const getSettings = () => {
				try {
					const svc: any = container.settingsService as any;
					if (svc && typeof svc.getRaw === "function") {
						return svc.getRaw() as typeof container.settings;
					}
					if (svc && typeof svc.get === "function") {
						return svc.get() as typeof container.settings;
					}
				} catch {}
				return container.settings;
			};

			const getFlags = () => {
				const s: any = getSettings();
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
					// Atomic-ish update of the entire doc to avoid line-by-line interleaving.
					try {
						const current = editor.getValue();
						const eol = current.includes("\r\n") ? "\r\n" : "\n";
						const next = newLines.join(eol);
						if (next === current) return;

						const cur = editor.getCursor();
						isMutating = true;
						try {
							if (
								typeof (editor as any).setValue === "function"
							) {
								(editor as any).setValue(next);
							} else {
								// Fallback: replace the entire range
								const lineCount = editor.lineCount();
								const lastLineLen =
									editor.getLine(lineCount - 1)?.length ?? 0;
								editor.replaceRange(
									next,
									{ line: 0, ch: 0 },
									{ line: lineCount - 1, ch: lastLineLen }
								);
							}
							// Restore cursor as best-effort (clamped)
							const maxLine = Math.max(0, editor.lineCount() - 1);
							const line = Math.min(cur.line, maxLine);
							const lineLen = editor.getLine(line)?.length ?? 0;
							const ch = Math.max(0, Math.min(cur.ch, lineLen));
							if (
								typeof (editor as any).setCursor === "function"
							) {
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
				onProgressStart: ({ title, total }) =>
					progress.start(title, total),
				onProgressUpdate: ({ current, total, message }) =>
					progress.update(current, total, message),
				onProgressEnd: () => progress.end(),

				onLineCommitted: (cb) => {
					let detachDom: (() => void) | null = null;

					// Prefer CM6 contentDOM; fallback to querying the view for ".cm-content"
					const cmContent: HTMLElement | undefined = (editor as any)
						?.cm?.contentDOM;
					const queriedContent = view.containerEl.querySelector(
						".cm-content"
					) as HTMLElement | null;
					const el: HTMLElement | null =
						(cmContent ?? queriedContent) || null;

					const keyHandler = (ev: KeyboardEvent) => {
						if (isMutating) return;
						// Treat Enter as "commit" of current line
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

					// Also detect commits that increase total line count (e.g., paste/newline insert)
					const off = app.workspace.on("editor-change", (mdView) => {
						if (isMutating) return;
						if (!(mdView instanceof MarkdownView)) return;
						if (mdView !== view) return;
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

					// Prefer CM6 contentDOM; fallback to querying the view for ".cm-content"
					const cmContent: HTMLElement | undefined = (editor as any)
						?.cm?.contentDOM;
					const queriedContent = view.containerEl.querySelector(
						".cm-content"
					) as HTMLElement | null;
					const targetEl: HTMLElement | null =
						(cmContent ?? queriedContent) || null;

					// Frame-coalesced notifier to avoid multiple callbacks in the same frame
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
							app.workspace.getActiveViewOfType(MarkdownView);
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

					// 1) Document-level selectionchange is reliable for caret moves
					const selectionHandler = () => {
						try {
							const sel = document.getSelection();
							if (!sel || !sel.anchorNode) return;

							if (targetEl && targetEl.contains(sel.anchorNode)) {
								scheduleNotify();
							} else if (!targetEl) {
								const active =
									app.workspace.getActiveViewOfType(
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

					// 2) Pointer/mouse interactions that change caret placement
					if (targetEl) {
						const pointerUp = () => scheduleNotify();
						const click = () => scheduleNotify();
						targetEl.addEventListener("pointerup", pointerUp, true);
						targetEl.addEventListener("click", click, true);
						detachFns.push(() =>
							targetEl.removeEventListener(
								"pointerup",
								pointerUp,
								true
							)
						);
						detachFns.push(() =>
							targetEl.removeEventListener("click", click, true)
						);
					}

					// 3) Keyboard navigation keys that often move between lines
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
						targetEl.addEventListener(
							"keydown",
							navKeyHandler,
							true
						);
						detachFns.push(() =>
							targetEl.removeEventListener(
								"keydown",
								navKeyHandler,
								true
							)
						);
					}

					// 4) Mirror with workspace editor-change (content edits may move caret)
					const offEdit = app.workspace.on(
						"editor-change",
						(mdView) => {
							if (!(mdView instanceof MarkdownView)) return;
							if (mdView !== view) return;
							scheduleNotify();
						}
					);
					detachFns.push(() => app.workspace.offref(offEdit));

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
					const off1 = app.workspace.on(
						"active-leaf-change",
						(_leaf) => {
							if (isMutating) return;
							const active =
								app.workspace.getActiveViewOfType(MarkdownView);
							if (active === view) {
								const flags = getFlags();
								if (!flags.master || !flags.onLeafChange)
									return;
								cb();
							}
						}
					);
					const off2 = app.workspace.on("file-open", (_file) => {
						if (isMutating) return;
						const active =
							app.workspace.getActiveViewOfType(MarkdownView);
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
				// Live gating based on current settings
				shouldRun: () => getFlags(),
			});
			(view as any).__canonicalProbe = () => {
				orchestrator.triggerOnceNow("manual", "line");
			};
			canonicalOrchestrators.set(view, orchestrator);

			// NEW: Ensure an initial whole-file format after wiring this view,
			// so leaf/file change formatting happens even for the change that caused this wire.
			const flagsAtWire = getFlags();
			if (flagsAtWire.master && flagsAtWire.onLeafChange) {
				// Defer to next tick to allow Obsidian to fully settle the new view state.
				setTimeout(() => {
					const stillActive =
						app.workspace.getActiveViewOfType(MarkdownView) ===
						view;
					if (!stillActive) return;
					orchestrator.triggerOnceNow("leaf-or-file", "file");
				}, 0);
			}
		} catch (e) {
			// Keep a warning on failure to wire; no verbose debug logs elsewhere.
			console.warn(
				"Failed to wire canonical formatter for the current view",
				e
			);
		}
	};

	const rewireForActiveView = () => {
		const active = app.workspace.getActiveViewOfType(MarkdownView) ?? null;
		if (currentView) {
			unwireCanonicalFormatter(currentView);
		}
		currentView = active;
		if (currentView) {
			try {
				wireTemplatingDomHandlers(
					app,
					currentView,
					plugin,
					templatingPorts
				);
			} catch {}
			try {
				// UX Shortcuts (Enter-to-repeat template)
				wireTemplatingUxShortcutsDomHandlers(app, currentView, plugin);
			} catch {}
			try {
				const orgPorts = (container as any).orgStructurePorts as
					| { orgStructure: OrgStructurePort }
					| undefined;
				if (orgPorts?.orgStructure) {
					wireTaskAssignmentDomHandlers(app, currentView, plugin, {
						orgStructure: orgPorts.orgStructure,
					});
				}
			} catch {}
			wireCanonicalFormatter(currentView);
		}
	};

	// Initial wire
	rewireForActiveView();

	plugin.registerEvent(
		app.workspace.on("active-leaf-change", (_leaf) => {
			rewireForActiveView();
		})
	);

	plugin.registerEvent(
		app.workspace.on("file-open", (_file) => {
			rewireForActiveView();
		})
	);

	// Vault-wide "Format All Files" wiring (triggered from Settings UI)
	plugin.registerEvent(
		// @ts-ignore - custom workspace events supported
		app.workspace.on("agile-canonical-format-all", async () => {
			try {
				const mdFiles = app.vault.getMarkdownFiles();
				let changedFiles = 0;
				let changedLines = 0;

				for (const f of mdFiles) {
					const content = await app.vault.read(f);

					// Preserve EOL style and terminal newline
					const useCRLF = content.includes("\r\n");
					const eol = useCRLF ? "\r\n" : "\n";
					const hasTerminalEOL = content.endsWith(eol);

					const lines = content.split(/\r?\n/);
					let fileChanged = false;
					const out: string[] = new Array(lines.length);

					for (let i = 0; i < lines.length; i++) {
						const oldLine = lines[i] ?? "";
						const indentMatch = oldLine.match(/^\s*/);
						const indent = indentMatch ? indentMatch[0] : "";
						const sansIndent = oldLine.slice(indent.length);
						const normalizedSansIndent =
							normalizeTaskLine(sansIndent);
						const newLine = indent + normalizedSansIndent;
						out[i] = newLine;
						if (newLine !== oldLine) {
							fileChanged = true;
							changedLines++;
						}
					}

					if (fileChanged) {
						let next = out.join(eol);
						// Restore terminal newline exactly as in original
						if (hasTerminalEOL && !next.endsWith(eol)) {
							next += eol;
						} else if (!hasTerminalEOL && next.endsWith(eol)) {
							next = next.slice(0, -eol.length);
						}
						await app.vault.modify(f, next);
						changedFiles++;
					}
				}

				new ObsidianNotice(
					`Canonical formatting complete: ${changedFiles} file(s), ${changedLines} line(s) updated.`
				);
			} catch (e) {
				new ObsidianNotice(
					`Canonical formatting failed: ${
						e instanceof Error ? e.message : String(e)
					}`
				);
			}
		})
	);

	const orgStructureService = createOrgStructureService({
		app,
		settings: container.settings,
	});
	await orgStructureService.buildAll();
	plugin.registerEvent(
		app.vault.on("create", (_f) => orgStructureService["buildAll"]())
	);
	plugin.registerEvent(
		app.vault.on("modify", (_f) => orgStructureService["buildAll"]())
	);
	plugin.registerEvent(
		app.vault.on("delete", (_f) => orgStructureService["buildAll"]())
	);
	plugin.registerEvent(
		app.vault.on("rename", (_f, _old) => orgStructureService["buildAll"]())
	);
	const orgStructurePort: OrgStructurePort = {
		getOrgStructure: orgStructureService.getOrgStructure,
		getTeamMembersForFile: orgStructureService.getTeamMembersForPath,
	};
	(container as any).orgStructureService = orgStructureService;
	(container as any).orgStructurePorts = { orgStructure: orgStructurePort };

	try {
		await registerTaskAssignmentDynamicCommands(
			app,
			plugin,
			plugin.manifest.id,
			{
				orgStructure: orgStructurePort,
			}
		);
	} catch (e) {
		console.error("[boot] assignment commands failed", e);
	}

	try {
		wireTaskAssignmentCascade(app, plugin, { taskIndex: taskIndexService });
	} catch (e) {
		console.error("[boot] assignment cascade wiring failed", e);
	}

	try {
		// Custom-event adapter (still available for manual commands)
		wireTaskClosedCascade(app, plugin);

		// 1) Status sequence first: ensures our checkbox char overrides Obsidian defaults immediately
		wireTaskStatusSequence(app, plugin);

		// 2) Then date manager: reacts to closed/reopen transitions immediately and via events
		wireTaskCloseManager(app, plugin);
	} catch (e) {
		console.error("[boot] closed cascade wiring failed", e);
	}

	try {
		registerTaskMetadataCleanup(container);
	} catch (e) {
		console.error("[boot] task-metadata-cleanup wiring failed", e);
	}
}
