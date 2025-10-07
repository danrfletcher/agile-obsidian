/**
 * Dynamic template commands registrar.
 *
 * Responsibilities:
 * - Register one Obsidian command per preset template (excluding hiddenFromDynamicCommands).
 * - Dynamically enable/disable each command using a checkCallback based on the current cursor context.
 * - Keep an "allowed templates" set up-to-date using a debounced, guarded evaluation triggered by cursor and content changes.
 *
 * Notes:
 * - Uses getCursorContext from @platform/obsidian to gather context (no direct Editor type imports).
 * - Debounce: ~250ms after typing stops; also immediate when changing line/file, or when the current line changes length by more than 1 char (e.g., paste).
 */

import type { App, Plugin } from "obsidian";
import { MarkdownView, Notice } from "obsidian";
import { getCursorContext } from "@platform/obsidian";
import { presetTemplates } from "../domain/presets";
import type { TemplateDefinition, TemplateContext } from "../domain/types";
import { isAllowedInContext } from "../domain/rules";
import { getArtifactParentChainTemplateIds } from "../domain/task-template-parent-chain";
import { insertTemplateAtCursor, findTemplateById } from "./templating-service";
import { showSchemaModal } from "@features/templating-params-editor";
import { showJsonModal } from "@features/templating-params-editor";

// New: unify param collection via templating-params-editor
import {
	requestTemplateParams,
	type ParamsTemplatingPorts,
} from "@features/templating-params-editor";

function collectTemplates(): Array<{ id: string; def: TemplateDefinition }> {
	const out: Array<{ id: string; def: TemplateDefinition }> = [];
	const groups = presetTemplates as unknown as Record<
		string,
		Record<string, TemplateDefinition>
	>;
	for (const [group, defs] of Object.entries(groups)) {
		for (const [key, def] of Object.entries(defs)) {
			const id = `${group}.${key}`;
			if ((def as any)?.hiddenFromDynamicCommands) continue;
			out.push({ id, def });
		}
	}
	return out;
}

function makeCommandId(manifestId: string, templateId: string): string {
	const slug = templateId.replace(/[^a-zA-Z0-9_.-]/g, "_").toLowerCase();
	return `${manifestId}:tpl:${slug}`;
}

export async function registerTemplatingDynamicCommands(
	app: App,
	plugin: Plugin,
	manifestId: string
): Promise<void> {
	const templates = collectTemplates();

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
		const editor: any = (view as any).editor;
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
				editor: editor as any,
			};

			const nextAllowed = new Set<string>();
			for (const { id, def } of templates) {
				const ok = isAllowedInContext(
					tctx,
					def.rules,
					getArtifactParentChainTemplateIds
				);
				if (ok) nextAllowed.add(id);
			}

			allowed.clear();
			for (const id of nextAllowed) allowed.add(id);
			lastCtxKey = key;
			lastLineLen = lineText.length;
		} catch {
			// ignore
		}
	}

	function scheduleRecompute(reason: "cursor" | "edit" | "leaf" | "file") {
		const view = getActiveView();
		if (!view) return;
		const editor: any = (view as any).editor;

		const filePath = (view.file?.path ?? "") as string;
		const cursor = editor?.getCursor?.() ?? { line: 0 };
		const lineNo = typeof cursor.line === "number" ? cursor.line : 0;
		const key = makeCtxKey(filePath, lineNo);
		const currentLineText =
			typeof editor?.getLine === "function" ? editor.getLine(lineNo) : "";
		const curLen = (currentLineText ?? "").length;

		let delay = DEBOUNCE_MS;

		if (key !== lastCtxKey) delay = 0;
		if (lastLineLen >= 0 && Math.abs(curLen - lastLineLen) > 1) {
			delay = Math.min(delay, 100);
		}

		if (timer != null) {
			window.clearTimeout(timer);
			timer = null;
		}

		timer = window.setTimeout(async () => {
			if (inFlight) {
				pending = true;
				return;
			}
			inFlight = true;
			await recomputeAllowedIfNeeded(reason);
			inFlight = false;
			if (pending) {
				pending = false;
				await recomputeAllowedIfNeeded("pending");
			}
		}, delay) as unknown as number;
	}

	for (const { id, def } of templates) {
		const cmdId = makeCommandId(manifestId, id);
		const name = def.label
			? `Insert template: ${def.label}`
			: `Insert template: ${id}`;

		plugin.addCommand({
			id: cmdId,
			name,
			checkCallback: (checking: boolean) => {
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
				const editor: any = (view as any).editor;

				void (async () => {
					try {
						let params: Record<string, unknown> | undefined;

						if (def.hasParams) {
							// Delegate to templating-params-editor for param collection
							const ports: ParamsTemplatingPorts = {
								findTemplateById: (tid) =>
									findTemplateById(tid) as any,
								showSchemaModal: (tid, schema, isEdit) =>
									showSchemaModal(
										app,
										tid,
										schema as any,
										isEdit
									) as Promise<
										Record<string, unknown> | undefined
									>,
								showJsonModal: (tid, initialJson) =>
									showJsonModal(
										app,
										tid,
										initialJson
									) as Promise<
										Record<string, unknown> | undefined
									>,
							};

							params = await requestTemplateParams(
								ports,
								id,
								{}, // no prefill for 'create'
								false,
								undefined // let the underlying modals handle notices
							);
							if (!params) return;
						}

						const ctx = await getCursorContext(app, view, editor);
						const filePath = ctx.filePath || "";
						insertTemplateAtCursor(id, editor, filePath, params);
					} catch (err) {
						new Notice(
							`Insert failed: ${String(
								(err as Error)?.message ?? err
							)}`
						);
					}
				})();

				return true;
			},
		});
	}

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
