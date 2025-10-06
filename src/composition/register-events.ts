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
} from "@features/task-canonical-formatter";
import type { CanonicalFormatterPort } from "@features/task-canonical-formatter";

import { wireTaskAssignmentCascade } from "@features/task-assignment-cascade";
import {
	wireTaskClosedCascade,
	// wireTaskClosedCascadeObserver, // removed: superseded by task-close-manager
} from "@features/task-close-cascade";
import { registerTaskMetadataCleanup } from "@features/task-metadata-cleanup";
import { wireTaskCloseManager } from "@features/task-close-manager";
import { wireTaskStatusSequence } from "@features/task-status-sequence";

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
	const { plugin, app, settings } = container;
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
		},
	};
	(container as any).templatingPorts = templatingPorts;

	// Canonical formatter per-view
	const canonicalOrchestrators = new WeakMap<
		MarkdownView,
		ReturnType<typeof createCanonicalFormatterOrchestrator>
	>();
	const editorUnsubs = new WeakMap<MarkdownView, Array<() => void>>();

	const wireCanonicalFormatter = (view: MarkdownView | null) => {
		if (!view) return;
		try {
			const editor = view.editor;
			if (!editor) return;
			let lastDocLineCount = editor.lineCount();
			let lastCursorLine = editor.getCursor().line;
			const progress = ProgressNotice.getOrCreateForView(view);
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
				replaceLineWithSelection: (lineNumber, newLine, newSel) => {
					const oldLine = editor.getLine(lineNumber);
					if (oldLine === newLine) return;
					editor.replaceRange(
						newLine,
						{ line: lineNumber, ch: 0 },
						{ line: lineNumber, ch: oldLine.length }
					);
					editor.setSelection(
						{ line: lineNumber, ch: newSel.start },
						{ line: lineNumber, ch: newSel.end }
					);
				},
				replaceLine: (lineNumber, newLine) => {
					const oldLine = editor.getLine(lineNumber);
					if (oldLine === newLine) return;
					editor.replaceRange(
						newLine,
						{ line: lineNumber, ch: 0 },
						{ line: lineNumber, ch: oldLine.length }
					);
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
					// @ts-ignore
					const cm = (editor as any).cm;
					const cmHasWrapper =
						!!cm && typeof cm.getWrapperElement === "function";
					const el: HTMLElement | null = cmHasWrapper
						? cm.getWrapperElement()
						: (view as any).contentEl || null;
					const keyHandler = (ev: KeyboardEvent) => {
						if (ev.key === "Enter" && !ev.isComposing) cb();
					};
					if (el && typeof el.addEventListener === "function") {
						el.addEventListener("keydown", keyHandler);
						detachDom = () =>
							el.removeEventListener("keydown", keyHandler);
					}
					const off = app.workspace.on("editor-change", (mdView) => {
						if (!(mdView instanceof MarkdownView)) return;
						if (mdView !== view) return;
						const currentCount = editor.lineCount();
						if (currentCount > lastDocLineCount) cb();
						lastDocLineCount = currentCount;
					});
					return () => {
						if (detachDom) detachDom();
						app.workspace.offref(off);
					};
				},
				onCursorLineChanged: (cb) => {
					const handler = () => {
						const cl = editor.getCursor().line;
						if (cl !== lastCursorLine) {
							lastCursorLine = cl;
							cb();
						}
					};
					let detachFns: Array<() => void> = [];
					// @ts-ignore
					const cm = (editor as any).cm;
					const hasCM =
						!!cm &&
						typeof cm.on === "function" &&
						typeof cm.off === "function";
					if (hasCM) {
						try {
							const cmHandler = () => handler();
							cm.on("cursorActivity", cmHandler);
							detachFns.push(() =>
								cm.off("cursorActivity", cmHandler)
							);
						} catch {}
					}
					const offEdit = app.workspace.on(
						"editor-change",
						(mdView) => {
							if (!(mdView instanceof MarkdownView)) return;
							if (mdView !== view) return;
							handler();
						}
					);
					detachFns.push(() => app.workspace.offref(offEdit));
					let el: HTMLElement | null = null;
					try {
						el =
							cm && typeof cm.getWrapperElement === "function"
								? cm.getWrapperElement()
								: (view as any).contentEl || null;
					} catch {
						el = (view as any).contentEl || null;
					}
					if (el && typeof el.addEventListener === "function") {
						const domKeyup = () => handler();
						const domMouseup = () => handler();
						el.addEventListener("keyup", domKeyup);
						el.addEventListener("mouseup", domMouseup);
						detachFns.push(() =>
							el?.removeEventListener("keyup", domKeyup)
						);
						detachFns.push(() =>
							el?.removeEventListener("mouseup", domMouseup)
						);
					}
					return () => {
						for (const off of detachFns) {
							try {
								off();
							} catch {}
						}
						detachFns = [];
					};
				},
				onLeafOrFileChanged: (cb) => {
					const off1 = app.workspace.on(
						"active-leaf-change",
						(_leaf) => {
							const active =
								app.workspace.getActiveViewOfType(MarkdownView);
							if (active === view) cb();
						}
					);
					const off2 = app.workspace.on("file-open", (_file) => {
						const active =
							app.workspace.getActiveViewOfType(MarkdownView);
						if (active === view) cb();
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
				debounceMs: 250,
			});
			(view as any).__canonicalProbe = () => {
				orchestrator.triggerOnceNow("manual", "line");
			};
			canonicalOrchestrators.set(view, orchestrator);
			editorUnsubs.set(view, []);
		} catch {}
	};

	const unwireCanonicalFormatter = (view: MarkdownView | null) => {
		if (!view) return;
		const orch = canonicalOrchestrators.get(view);
		if (orch) {
			try {
				orch.dispose();
			} catch {}
			canonicalOrchestrators.delete(view);
		}
		const unsubs = editorUnsubs.get(view);
		if (unsubs) {
			for (const off of unsubs) {
				try {
					off();
				} catch {}
			}
			editorUnsubs.delete(view);
		}
		const lingering = (ProgressNotice as any).activeForView?.get?.(view);
		if (lingering) {
			try {
				(lingering as any).end?.();
			} catch {}
		}
	};

	const tryWireView = (view: MarkdownView | null) => {
		if (!view) return;
		try {
			wireTemplatingDomHandlers(app, view, plugin, templatingPorts);
		} catch {}
		try {
			// UX Shortcuts (Enter-to-repeat template)
			wireTemplatingUxShortcutsDomHandlers(app, view, plugin);
		} catch {}
		try {
			const orgPorts = (container as any).orgStructurePorts as
				| { orgStructure: OrgStructurePort }
				| undefined;
			if (orgPorts?.orgStructure) {
				wireTaskAssignmentDomHandlers(app, view, plugin, {
					orgStructure: orgPorts.orgStructure,
				});
			}
		} catch {}
		wireCanonicalFormatter(view);
	};

	tryWireView(app.workspace.getActiveViewOfType(MarkdownView) ?? null);

	plugin.registerEvent(
		app.workspace.on("active-leaf-change", (leaf) => {
			const prevActive = app.workspace.getActiveViewOfType(MarkdownView);
			if (prevActive) {
				unwireCanonicalFormatter(prevActive);
			}
			if (!leaf) return;
			const newView =
				(leaf.view instanceof MarkdownView
					? (leaf.view as MarkdownView)
					: app.workspace.getActiveViewOfType(MarkdownView)) ?? null;
			tryWireView(newView);
		})
	);

	plugin.registerEvent(
		app.workspace.on("file-open", (_file) => {
			const view = app.workspace.getActiveViewOfType(MarkdownView);
			tryWireView(view ?? null);
		})
	);

	const orgStructureService = createOrgStructureService({ app, settings });
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

		// Note: Removed passive observer so cascade runs AFTER manager adds dates
		// wireTaskClosedCascadeObserver(app, plugin);
	} catch (e) {
		console.error("[boot] closed cascade wiring failed", e);
	}

	tryWireView(app.workspace.getActiveViewOfType(MarkdownView) ?? null);

	try {
		registerTaskMetadataCleanup(container);
	} catch (e) {
		console.error("[boot] task-metadata-cleanup wiring failed", e);
	}
}
