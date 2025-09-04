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
import { insertTemplateAtCursor } from "./templating-service";
import { showSchemaModal } from "../ui/template-schema-modal";
import { showJsonModal } from "../ui/template-json-modal";

/**
 * Gather all non-hidden template definitions in a flattened list.
 */
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

/**
 * Create a safe and unique command id.
 */
function makeCommandId(manifestId: string, templateId: string): string {
	const slug = templateId.replace(/[^a-zA-Z0-9_.-]/g, "_").toLowerCase();
	return `${manifestId}:tpl:${slug}`;
}

/**
 * Register all templating commands, dynamically enabled by current allowed set.
 */
export async function registerTemplatingDynamicCommands(
	app: App,
	plugin: Plugin,
	manifestId: string
): Promise<void> {
	const templates = collectTemplates();

	// State used for dynamic allow-list recomputation
	const allowed = new Set<string>(); // templateId -> allowed
	let lastCtxKey = ""; // track cursor state to guard recomputation
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

	async function recomputeAllowedIfNeeded(trigger: string) {
		// Throttle guard if running too frequently
		const now = Date.now();
		if (now - lastRunAt < THROTTLE_MIN_MS && !pending) {
			// schedule one trailing run
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

			// Update last-run timestamp
			lastRunAt = now;

			// Build TemplateContext used by rule evaluation
			const tctx: TemplateContext = {
				line: lineText,
				file: ctx.fileContent ?? "",
				path: filePath,
				editor: editor as any,
			};

			// Evaluate
			const nextAllowed = new Set<string>();
			for (const { id, def } of templates) {
				const ok = isAllowedInContext(
					tctx,
					def.rules,
					getArtifactParentChainTemplateIds
				);
				if (ok) nextAllowed.add(id);
			}

			// Commit
			allowed.clear();
			for (const id of nextAllowed) allowed.add(id);
			lastCtxKey = key;
			lastLineLen = lineText.length;
		} catch {
			// swallow
		}
	}

	function scheduleRecompute(reason: "cursor" | "edit" | "leaf" | "file") {
		const view = getActiveView();
		if (!view) return;
		const editor: any = (view as any).editor;
		// We will attempt to guard using current snapshot synchronously (best effort)
		const filePath = (view.file?.path ?? "") as string;
		const cursor = editor?.getCursor?.() ?? { line: 0 };
		const lineNo = typeof cursor.line === "number" ? cursor.line : 0;
		const key = makeCtxKey(filePath, lineNo);
		const currentLineText =
			typeof editor?.getLine === "function" ? editor.getLine(lineNo) : "";
		const curLen = (currentLineText ?? "").length;

		// Decide debounce delay and whether to skip recompute
		let delay = DEBOUNCE_MS;

		// If file or line changed -> recompute quickly
		if (key !== lastCtxKey) delay = 0;

		// If line length changed significantly (>1 char), e.g., paste, recompute quickly
		if (lastLineLen >= 0 && Math.abs(curLen - lastLineLen) > 1) {
			delay = Math.min(delay, 100);
		}

		// Reset previous timer
		if (timer != null) {
			window.clearTimeout(timer);
			timer = null;
		}

		// Debounced invoke
		timer = window.setTimeout(async () => {
			if (inFlight) {
				// collapse multiple triggers into one
				pending = true;
				return;
			}
			inFlight = true;
			await recomputeAllowedIfNeeded(reason);
			inFlight = false;
			if (pending) {
				pending = false;
				// chain one more run to capture the latest state after the in-flight one
				await recomputeAllowedIfNeeded("pending");
			}
		}, delay) as unknown as number;
	}

	// Register one command per template
	for (const { id, def } of templates) {
		const cmdId = makeCommandId(manifestId, id);
		const name = def.label
			? `Insert template: ${def.label}`
			: `Insert template: ${id}`;

		plugin.addCommand({
			id: cmdId,
			name,
			checkCallback: (checking: boolean) => {
				// Use cached allow-list
				const isAllowed = allowed.has(id);
				if (checking) return isAllowed;

				// When invoked (not checking), if currently not allowed, show a notice and bail.
				if (!isAllowed) {
					new Notice("Template not allowed in the current context.");
					return true;
				}

				// Perform the insertion flow with params handling
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
							if (
								def.paramsSchema &&
								def.paramsSchema.fields?.length
							) {
								// Clone schema shallowly for safety
								const schema = {
									...def.paramsSchema,
									fields:
										def.paramsSchema.fields?.map((f) => ({
											...f,
										})) ?? [],
								};
								params = await showSchemaModal(
									app,
									id,
									schema,
									false
								);
								if (!params) return;
							} else {
								// No schema -> JSON modal
								const jsonParams = "{}";
								const parsed = (await showJsonModal(
									app,
									id,
									jsonParams
								)) as Record<string, unknown> | undefined;
								if (!parsed) return;
								params = parsed;
							}
						}

						// Get latest file path via context abstraction
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

	// Initial compute
	scheduleRecompute("cursor");

	// Cursor movement
	// plugin.registerEvent(
	// 	app.workspace.on("", () => {
	// 		scheduleRecompute("cursor");
	// 	})
	// );

	// Content changes
	plugin.registerEvent(
		app.workspace.on("editor-change", () => {
			scheduleRecompute("edit");
		})
	);

	// Leaf / file changes also influence context
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
