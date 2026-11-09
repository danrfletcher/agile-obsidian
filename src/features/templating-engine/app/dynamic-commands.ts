/**
 * Dynamic template commands registrar.
 *
 * Responsibilities:
 * - Register one Obsidian command per ACTIVE template in the template registry (excluding
 *   hiddenFromDynamicCommands). On every registry change the set of registered commands is
 *   diffed against the active list: `removeCommand` for ids no longer active, `addCommand`
 *   for new ones. A live id is never added twice. Command ids stay the same across
 *   off -> on, so hotkeys bound to them keep working once the command is back.
 * - Dynamically enable/disable each command using a checkCallback based on the current cursor context.
 * - Keep an "allowed templates" set up-to-date using a debounced, guarded evaluation triggered by cursor and content changes.
 *
 * Notes:
 * - Uses getCursorContext from @platform/obsidian to gather context.
 * - Debounce: ~250ms after typing stops; also immediate when changing line/file, or when the current line changes length by more than 1 char (e.g., paste).
 */

import type { App, Editor, Plugin } from "obsidian";
import { MarkdownView, Notice } from "obsidian";
import { getCursorContext } from "@platform/obsidian";
import type { TemplateDefinition, TemplateContext } from "../domain/types";
import { isAllowedInContext } from "../domain/rules";
import { getArtifactParentChainTemplateIds } from "../domain/task-template-parent-chain";
import { insertTemplateAtCursor, findTemplateById } from "./templating-service";
import { findActiveTemplate, listActiveTemplates, onTemplateRegistryChange } from "./template-registry";
import { showSchemaModal, showJsonModal } from "@features/templating-params-editor";

// New: unify param collection via templating-params-editor
import {
	requestTemplateParams,
	type ParamsTemplatingPorts,
} from "@features/templating-params-editor";

// New: insertion workflows
import { runTemplateWorkflows } from "../domain/template-workflows";

/** Templates that get an insert command right now: the registry's active list. */
function collectTemplates(): Array<{ id: string; def: TemplateDefinition }> {
	const out: Array<{ id: string; def: TemplateDefinition }> = [];
	for (const def of listActiveTemplates()) {
		if (def.hiddenFromDynamicCommands) continue;
		out.push({ id: def.id, def });
	}
	return out;
}

function commandName(id: string, label: string | undefined): string {
	return label ? `Insert template: ${label}` : `Insert template: ${id}`;
}

function makeCommandId(manifestId: string, templateId: string): string {
	const slug = templateId.replace(/[^a-zA-Z0-9_.-]/g, "_").toLowerCase();
	return `${manifestId}:tpl:${slug}`;
}

/**
 * Register templating dynamic commands.
 * @param app Obsidian app
 * @param plugin Plugin instance
 * @param manifestId Plugin manifest id
 */
export async function registerTemplatingDynamicCommands(
	app: App,
	plugin: Plugin,
	manifestId: string
): Promise<void> {
	// Dynamic allow-list state
	const allowed = new Set<string>();
	let lastCtxKey = "";
	let lastLineLen = -1;
	let lastRunAt = 0;
	let timer: number | null = null;
	let inFlight = false;
	let pending = false;

	const DEBOUNCE_MS = 250;
	const THROTTLE_MIN_MS = 200;

	function getActiveView(): MarkdownView | null {
		return app.workspace.getActiveViewOfType(MarkdownView) ?? null;
	}

	function makeCtxKey(filePath: string, lineNumber: number) {
		return `${filePath}::${lineNumber}`;
	}

	async function recomputeAllowedIfNeeded(_trigger: string) {
		const now = Date.now();
		if (now - lastRunAt < THROTTLE_MIN_MS && !pending) {
			pending = true;
			window.setTimeout(() => {
				pending = false;
				void recomputeAllowedIfNeeded("throttled");
			}, THROTTLE_MIN_MS);
			return;
		}

		const view = getActiveView();
		if (!view) return;
		const editor: Editor = view.editor;

		try {
			const ctx = await getCursorContext(app, view, editor);
			const filePath = ctx.filePath || "";
			const lineNo = ctx.lineNumber ?? 0;
			const key = makeCtxKey(filePath, lineNo);
			const lineText = ctx.lineText ?? "";

			lastRunAt = now;

			const tctx: TemplateContext = {
				line: lineText,
				file: ctx.fileContent ?? "",
				path: filePath,
				editor,
			};

			const nextAllowed = new Set<string>();
			for (const { id, def } of collectTemplates()) {
				const ok = isAllowedInContext(
					tctx,
					def.rules,
					getArtifactParentChainTemplateIds
				);
				if (ok) nextAllowed.add(id);
			}

			allowed.clear();
			for (const allowedId of nextAllowed) allowed.add(allowedId);
			lastCtxKey = key;
			lastLineLen = lineText.length;
		} catch {
			// ignore
		}
	}

	function scheduleRecompute(
		reason: "cursor" | "edit" | "leaf" | "file" | "registry"
	) {
		const view = getActiveView();
		if (!view) return;
		const editor: Editor = view.editor;

		const filePath = view.file?.path ?? "";
		const cursor = editor.getCursor();
		const lineNo = cursor.line;
		const key = makeCtxKey(filePath, lineNo);
		const currentLineText = editor.getLine(lineNo) ?? "";
		const curLen = currentLineText.length;

		let delay = DEBOUNCE_MS;

		if (key !== lastCtxKey) delay = 0;
		if (lastLineLen >= 0 && Math.abs(curLen - lastLineLen) > 1) {
			delay = Math.min(delay, 100);
		}

		if (timer != null) {
			window.clearTimeout(timer);
			timer = null;
		}

		timer = window.setTimeout(() => {
			void (async () => {
				if (inFlight) {
					pending = true;
					return;
				}
				inFlight = true;
				try {
					await recomputeAllowedIfNeeded(reason);
					if (pending) {
						pending = false;
						await recomputeAllowedIfNeeded("pending");
					}
				} finally {
					inFlight = false;
				}
			})();
		}, delay);
	}

	function addTemplateCommand(
		id: string,
		cmdId: string,
		label: string | undefined
	): void {
		const name = commandName(id, label);

		plugin.addCommand({
			id: cmdId,
			name,
			checkCallback: (checking: boolean) => {
				// Read the registry at invocation time, never a captured definition.
				// An inactive template has no command: nothing to show, nothing to run.
				const def = findActiveTemplate(id);
				if (!def) return false;

				const isAllowed = allowed.has(id);
				if (checking) return isAllowed;

				if (!isAllowed) {
					new Notice("Template not allowed in the current context.");
					return true;
				}

				const view = getActiveView();
				if (!view) {
					new Notice("No active Markdown view.");
					return true;
				}
				const editor: Editor = view.editor;

				void (async () => {
					try {
						let params: Record<string, unknown> | undefined;

						if (def.hasParams) {
							// Delegate to templating-params-editor for param collection
							const paramPorts: ParamsTemplatingPorts = {
								findTemplateById: (tid) => findTemplateById(tid),
								showSchemaModal: (tid, schema, isEdit) =>
									showSchemaModal(app, tid, schema, isEdit),
								showJsonModal: (tid, initialJson) =>
									showJsonModal(app, tid, initialJson),
							};

							params = await requestTemplateParams(
								paramPorts,
								id,
								{}, // no prefill for 'create'
								false,
								undefined
							);
							if (!params) return;
						}

						const ctx = await getCursorContext(app, view, editor);
						const filePath = ctx.filePath || "";

						// Run optional insertion workflows before insertion. Awaited, so e.g.
						// Link to Artifact has read its target and resolved the type before
						// the chip is rendered; an unreadable target just yields no type.
						if (def.insertWorkflows && def.insertWorkflows.length) {
							params = await runTemplateWorkflows(
								def,
								params ?? {},
								{ app, sourcePath: filePath }
							);
						}

						// The template may have become inactive while the dialog was open
						// (e.g. "Default templates" switched off): cancel quietly.
						if (!findActiveTemplate(id)) return;

						insertTemplateAtCursor(id, editor, filePath, params);
					} catch (err) {
						const message =
							err instanceof Error ? err.message : String(err);
						new Notice(`Insert failed: ${message}`);
					}
				})();

				return true;
			},
		});
	}

	// Registered command ids (the exact string handed to addCommand, and so to
	// removeCommand). Obsidian prefixes plugin.addCommand/removeCommand ids with the
	// manifest id itself; makeCommandId already includes the manifest id, and we pass the
	// same unprefixed string to both calls so a remove can never silently miss.
	// Value: the command name it was registered with, so a changed label re-registers it.
	const registered = new Map<string, string>();

	function syncCommands(): void {
		const desired = new Map<string, { id: string; label?: string }>();
		for (const { id, def } of collectTemplates()) {
			desired.set(makeCommandId(manifestId, id), { id, label: def.label });
		}

		for (const [cmdId, name] of Array.from(registered)) {
			const want = desired.get(cmdId);
			if (want && commandName(want.id, want.label) === name) continue;
			plugin.removeCommand(cmdId);
			registered.delete(cmdId);
		}
		for (const [cmdId, { id, label }] of desired) {
			if (registered.has(cmdId)) continue;
			addTemplateCommand(id, cmdId, label);
			registered.set(cmdId, commandName(id, label));
		}

		// Forget allow-list entries for templates that are no longer active.
		const activeIds = new Set(Array.from(desired.values(), (d) => d.id));
		for (const id of Array.from(allowed)) {
			if (!activeIds.has(id)) allowed.delete(id);
		}
	}

	syncCommands();

	// Keep the palette in step with the registry: no reload, no duplicates.
	const offRegistry = onTemplateRegistryChange(() => {
		syncCommands();
		scheduleRecompute("registry");
	});
	plugin.register(offRegistry);
	plugin.register(() => {
		if (timer != null) {
			window.clearTimeout(timer);
			timer = null;
		}
	});

	scheduleRecompute("cursor");

	plugin.registerEvent(
		app.workspace.on("editor-change", () => {
			scheduleRecompute("edit");
		})
	);
	plugin.registerEvent(
		app.workspace.on("active-leaf-change", () => {
			scheduleRecompute("leaf");
		})
	);
	plugin.registerEvent(
		app.workspace.on("file-open", () => {
			scheduleRecompute("file");
		})
	);
}