/**
 * Templating orchestrators
 *
 * This module contains the high-level orchestration logic for the plugin's
 * templating feature. It exposes functions that implement user-facing
 * templating workflows (editing parameters of an existing rendered template
 * and auto-inserting a parameterized template when creating a new task line).
 *
 * Responsibilities:
 * - Coordinate between UI (modal) factories and domain services (templating
 *   service) to gather parameters, render templates, and perform insertions.
 * - Encapsulate decision logic (when to prompt, which template to use) while
 *   delegating rendering and DOM/editor mutations to services or the caller.
 * - Surface user-visible errors via Obsidian Notice and avoid leaking platform
 *   specifics (CodeMirror) beyond the adapter/event-manager layers.
 *
 * Usage:
 * - Called by the Event Manager (templating-event-manager) on click or Enter
 *   events. Keep these functions small and testable; they should be unit
 *   tested by mocking the UI modal functions and templating services.
 *
 * Design notes:
 * - This file should remain orchestration-only: UI creation lives in
 *   src/ui/modals/* and template rendering/inference lives in
 *   src/app/services/templating-service.ts. The Event Manager handles DOM
 *   wiring and lifecycle registration via plugin.registerDomEvent/registerEvent.
 */

import type { App, MarkdownView } from "obsidian";
import type { TemplateDefinition } from "src/domain/templating/types";
import {
	insertTemplateAtCursor,
	renderTemplateOnly,
	inferParamsForWrapper,
	getTemplateWrapperOnLine,
} from "../services/templating-service";
import { presetTemplates } from "../../domain/templating/presets";
import { getCursorContext } from "../editor/obsidian-editor-context";
import { showSchemaModal } from "../../ui/modals/template-schema-modal";
import { showJsonModal } from "../../ui/modals/template-json-modal";
import { Notice } from "obsidian";
import { isBlankTask } from "src/domain/tasks/task-filters";

/**
 * Handle a user click on a rendered template wrapper element.
 *
 * This orchestrator implements the "edit template parameters" feature:
 * it reads the clicked element's `data-template-key`, looks up the
 * corresponding template definition, infers any existing parameter
 * values from the wrapper DOM, prompts the user for updated parameters
 * (either with a structured schema form or a free-form JSON editor),
 * then re-renders the template HTML and replaces the wrapper in-place.
 *
 * Responsibilities & constraints:
 * - Delegates rendering to `templating-service.renderTemplateOnly`.
 * - Delegates parameter collection to `showSchemaModal` or `showJsonModal`.
 * - Performs DOM replacement via `el.outerHTML = newHtml` (single-element
 *   replacement).
 * - Reports user-facing failures via `new Notice(...)`.
 *
 * @param {import('obsidian').App} app - The Obsidian application instance (used by UI modals).
 * @param {HTMLElement} el - The element that was clicked (expected to contain
 *  `data-template-wrapper` and `data-template-key` attributes).
 * @returns {Promise<void>} Resolves when processing completes. Errors are
 * handled locally and surfaced to the user; callers do not need to catch.
 *
 * @example
 * // Invoked by the event manager when a user clicks a wrapper:
 * await processClick(app, clickedWrapperEl);
 *
 * @see {@link inferParamsForWrapper}, {@link renderTemplateOnly}, {@link showSchemaModal}, {@link showJsonModal}
 */
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
		if (!def || !def.hasParams) return;

		const prefill = inferParamsForWrapper(templateKey, el) ?? {};
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
			const newHtml = renderTemplateOnly(templateKey, params);
			el.outerHTML = newHtml;
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

/**
 * Handle Enter key events in the editor that may trigger template insertion.
 *
 * This orchestrator implements the "press Enter to create a parameterized
 * template instance" behavior. When the user presses Enter to create a new
 * list/task line directly beneath a template wrapper with an artifact-type
 * order tag, and the new line is a blank task (see `isBlankTask`), this
 * function will prompt the user for any required template parameters and
 * insert the rendered template at the cursor position.
 *
 * Responsibilities & constraints:
 * - Uses `getCursorContext` to determine file path and cursor/line context.
 * - Uses `getTemplateWrapperOnLine` to identify the wrapper on the previous line.
 * - Only proceeds for wrappers with `orderTag === 'artifact-item-type'`.
 * - Only supports schema-driven parameter prompting in the current flow; JSON
 *   modal is not used here by default.
 * - Delegates insertion to `insertTemplateAtCursor` and reports errors via `Notice`.
 *
 * @param {import('obsidian').App} app - The Obsidian App instance (used by modals).
 * @param {import('obsidian').MarkdownView} view - The active MarkdownView where Enter occurred.
 * @returns {Promise<void>} Resolves when insert flow finishes or is aborted.
 *
 * @example
 * // Called by TemplatingEventManager after observing Enter key on the editor:
 * await processEnter(app, mdView);
 *
 * @see {@link getCursorContext}, {@link getTemplateWrapperOnLine}, {@link insertTemplateAtCursor}
 */
export async function processEnter(
	app: App,
	view: MarkdownView
): Promise<void> {
	try {
		const editor = view.editor;
		const fullCtx = await getCursorContext(app, view, editor);
		const prevLine = fullCtx.lineNumber - 1;
		if (prevLine < 0) return;

		const wrapperInfo = getTemplateWrapperOnLine(view, prevLine);
		if (!wrapperInfo || !wrapperInfo.templateKey) return;
		if (wrapperInfo.orderTag !== "artifact-item-type") return;
		if (!isBlankTask(fullCtx.lineText)) return;

		const [g, k] = (wrapperInfo.templateKey ?? "").split(".");
		const groupMap = presetTemplates as unknown as Record<
			string,
			Record<string, TemplateDefinition>
		>;
		const def = groupMap[g]?.[k] as TemplateDefinition | undefined;
		if (!def || !def.hasParams) return;

		const schema = def.paramsSchema
			? {
					...def.paramsSchema,
					fields:
						def.paramsSchema.fields?.map((f) => ({ ...f })) ?? [],
			  }
			: undefined;
		if (!schema) return;
		const params = await showSchemaModal(
			app,
			wrapperInfo.templateKey,
			schema,
			false
		);
		if (!params) return;
		insertTemplateAtCursor(
			wrapperInfo.templateKey,
			editor,
			fullCtx.filePath,
			params as Record<string, unknown> | undefined
		);
	} catch (err) {
		new Notice(
			`Template insert failed: ${String((err as Error)?.message ?? err)}`
		);
	}
}
