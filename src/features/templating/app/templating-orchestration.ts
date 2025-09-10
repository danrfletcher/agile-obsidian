/**
 * Templating orchestrators (wiring-agnostic).
 */

import type { App } from "obsidian";
import type { TemplateDefinition } from "../domain/types";
import {
	insertTemplateAtCursor,
	renderTemplateOnly,
	prefillTemplateParams,
	replaceTemplateWrapperOnCurrentLine,
} from "./templating-service";
import { presetTemplates } from "../domain/presets";
import { getCursorContext } from "@platform/obsidian/";
import { showSchemaModal } from "../ui/template-schema-modal";
import { showJsonModal } from "../ui/template-json-modal";
import { MarkdownView, Notice } from "obsidian";
import type { TaskIndexPort } from "./templating-ports";

export async function processClick(app: App, el: HTMLElement): Promise<void> {
	try {
		const templateKey = el.getAttribute("data-template-key") ?? "";
		if (!templateKey) return;
		const [group, key] = templateKey.split(".");
		const groupMap = presetTemplates as unknown as Record<
			string,
			Record<string, TemplateDefinition>
		>;
		const def = groupMap[group]?.[key] as TemplateDefinition | undefined;

		// If this template is excluded from dynamic commands (like members.assignee),
		// do not open parameter modals on click. Let other feature handlers manage it.
		if (def?.hiddenFromDynamicCommands) return;

		if (!def || !def.hasParams) return;

		// Prefill strictly from explicit markers (plus template-specific override)
		const prefill = prefillTemplateParams(templateKey, el) ?? {};
		let params: Record<string, unknown> | undefined;
		if (def.paramsSchema && def.paramsSchema.fields?.length) {
			const schema = {
				...def.paramsSchema,
				fields: def.paramsSchema.fields.map((f) => ({
					...f,
					defaultValue:
						prefill[f.name] != null
							? String(prefill[f.name] ?? "")
							: f.defaultValue,
				})),
			};
			params = await showSchemaModal(app, templateKey, schema, true);
		} else {
			const jsonParams = JSON.stringify(prefill ?? {}, null, 2);
			params = (await showJsonModal(app, templateKey, jsonParams)) as
				| Record<string, unknown>
				| undefined;
		}
		if (!params) return;

		try {
			const view =
				app.workspace.getActiveViewOfType(MarkdownView) ?? null;
			const editor: any = (view as any)?.editor;
			if (!view || !editor) {
				// Fallback: DOM-only update
				const fresh = renderTemplateOnly(templateKey, params);
				// Preserve original instance id if present
				const instanceId =
					el.getAttribute("data-template-wrapper") ?? "";
				const freshWithSameId = instanceId
					? fresh.replace(
							/data-template-wrapper="[^"]*"/,
							`data-template-wrapper="${instanceId}"`
					  )
					: fresh;

				el.outerHTML = freshWithSameId;
				return;
			}

			// Render new HTML and preserve the original instance id
			const instanceId = el.getAttribute("data-template-wrapper") ?? "";
			let newHtml = renderTemplateOnly(templateKey, params);
			if (instanceId) {
				newHtml = newHtml.replace(
					/data-template-wrapper="[^"]*"/,
					`data-template-wrapper="${instanceId}"`
				);
			}

			await replaceTemplateWrapperOnCurrentLine(
				app,
				view,
				editor,
				templateKey,
				newHtml,
				instanceId // <-- pass exact wrapper instance id
			);
		} catch (e) {
			new Notice(
				`Failed to update template: ${String(
					(e as Error)?.message ?? e
				)}`
			);
		}
	} catch (err) {
		new Notice(
			`Template edit failed: ${String((err as Error)?.message ?? err)}`
		);
	}
}

export async function processEnter(
	app: App,
	view: MarkdownView,
	_ports: { taskIndex: TaskIndexPort }
): Promise<void> {
	try {
		const editor = view.editor;

		// Capture a fresh context after Enter.
		const ctx = await getCursorContext(app, view, editor);

		// Helper: detect if cursor was at end-of-line (ignoring trailing spaces) when Enter occurred.
		// We infer this by reading the current line text and ensuring nothing non-space exists after column.
		const lineText = ctx.lineText ?? editor.getLine(ctx.lineNumber) ?? "";
		const afterCursor = lineText.slice(ctx.column ?? 0);
		const cursorAtLogicalEOL = /^\s*$/.test(afterCursor);
		if (!cursorAtLogicalEOL) {
			return;
		}

		// We need to confirm the ENTER happened from an artifact-bearing line.
		// When Enter moves to next line, the previous line is ctx.lineNumber - 1.
		// Some timing jitter can happen, so we check:
		//   1) previous line
		//   2) current line (in case event fired slightly earlier/later)
		const filePath = ctx.filePath;
		const curLineNo = ctx.lineNumber;
		const prevLineNo = curLineNo - 1;

		const safeGetLine = (n: number) => {
			if (n < 0) return "";
			try {
				return editor.getLine(n) ?? "";
			} catch {
				return "";
			}
		};

		const prevLine = safeGetLine(prevLineNo);
		const curLine = safeGetLine(curLineNo);

		const findWrapperInRawLine = (s: string) => {
			const trimmed = (s ?? "").trim();
			if (!trimmed) return null;

			// Matches a wrapper like:
			// <span ... data-template-key="group.key" ... data-order-tag="..." ...>...</span>
			const wrapperRe =
				/<span\b[^>]*\bdata-template-key\s*=\s*"([^"]+)"[^>]*\bdata-order-tag\s*=\s*"([^"]+)"[^>]*>.*?<\/span>/i;

			const wrapperReNoOrder =
				/<span\b[^>]*\bdata-template-key\s*=\s*"([^"]+)"[^>]*>.*?<\/span>/i;

			let m = trimmed.match(wrapperRe);
			if (m) {
				return { templateKey: m[1] ?? null, orderTag: m[2] ?? null };
			}
			m = trimmed.match(wrapperReNoOrder);
			if (m) {
				return { templateKey: m[1] ?? null, orderTag: null };
			}
			return null;
		};

		// Prefer wrapper on previous line (the one we split), but accept current line if that’s where the wrapper is.
		let wrapperInfo =
			findWrapperInRawLine(prevLine) ?? findWrapperInRawLine(curLine);

		if (!wrapperInfo?.templateKey) {
			return;
		}

		// Only trigger for agile artifact chain
		if (wrapperInfo.orderTag !== "artifact-item-type") {
			return;
		}

		// Resolve the template definition to ensure it supports params with a schema
		const [g, k] = (wrapperInfo.templateKey ?? "").split(".");
		const groupMap = presetTemplates as unknown as Record<
			string,
			Record<string, TemplateDefinition>
		>;
		const def = groupMap[g]?.[k] as TemplateDefinition | undefined;
		if (!def || !def.hasParams) {
			return;
		}
		if (def.hiddenFromDynamicCommands) {
			return;
		}

		const schema = def.paramsSchema
			? {
					...def.paramsSchema,
					fields:
						def.paramsSchema.fields?.map((f) => ({ ...f })) ?? [],
			  }
			: undefined;
		if (!schema) {
			return;
		}

		// Open the modal immediately (no waiting for TaskIndex or blank-task detection)
		const params = await showSchemaModal(
			app,
			wrapperInfo.templateKey,
			schema,
			false
		);
		if (!params) {
			return;
		}

		// Insert at the current cursor. We don’t enforce that the new line is a blank task.
		insertTemplateAtCursor(
			wrapperInfo.templateKey,
			editor as any,
			filePath,
			params as Record<string, unknown> | undefined
		);
	} catch (err) {
		console.error(
			"[templating] processEnter: error",
			(err as Error)?.message ?? err
		);
		new Notice(
			`Template insert failed: ${String((err as Error)?.message ?? err)}`
		);
	}
}
