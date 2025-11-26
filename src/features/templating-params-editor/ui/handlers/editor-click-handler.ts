/**
 * UI click handler for editing template parameters inside regular notes (Markdown editor).
 * Works in the editor's content DOM (live preview), independent of dashboard structure.
 */

import type { App } from "obsidian";
import { Notice } from "obsidian";
import { editTemplateParamsOnDashboard } from "../../app/edit-template-params";
import type { AppDeps, RefreshPort } from "../../app/ports";

type RegisterDomEvent = (
	el: HTMLElement | Window | Document,
	type: string,
	handler: (evt: MouseEvent) => void,
	options?: AddEventListenerOptions | boolean
) => void;

export interface AttachEditorHandlerOptions {
	app: App;
	viewContainer: HTMLElement; // e.g., CodeMirror content DOM (.cm-content) or view.containerEl
	registerDomEvent: RegisterDomEvent;

	// Required ports
	deps: AppDeps;

	// File to update (current note path)
	filePath: string;

	// Optional hint: get a line number (0-based) at click time; will be used if instanceId is absent
	getLineHint0?: () => number | null;

	// Optional: provide a Notice adapter. If not provided and useObsidianNotice=true, default to Obsidian Notice.
	useObsidianNotice?: boolean;

	// For backward compat: allow passing refresh separately in case deps.refresh is shared
	refresh?: RefreshPort;
}

/**
 * Attach an editor templating handler.
 * Intercepts double-clicks on spans with data-template-wrapper and data-template-key,
 * opens edit flow, and persists changes to the current file.
 */
export function attachEditorTemplatingHandler(
	opts: AttachEditorHandlerOptions
): () => void {
	const {
		viewContainer,
		registerDomEvent,
		deps,
		filePath,
		getLineHint0,
		useObsidianNotice = true,
	} = opts;

	const notices =
		deps.notices ??
		(useObsidianNotice
			? {
					info: (msg: string) => new Notice(msg, 3000),
					warn: (msg: string) => new Notice(`Warning: ${msg}`, 5000),
					error: (msg: string) => new Notice(`Error: ${msg}`, 8000),
			  }
			: undefined);

	const onDblClick = async (evt: MouseEvent) => {
		try {
			const target = evt.target as HTMLElement | null;
			if (!target) return;

			// Detect parameterized template wrapper (rendered in live preview)
			const wrapper = target.closest(
				"span[data-template-wrapper][data-template-key]"
			) as HTMLElement | null;
			if (!wrapper) return;

			const templateKey = wrapper.getAttribute("data-template-key") || "";
			if (!templateKey) return;

			// Resolve template def BEFORE cancelling the event so other handlers can run if we don't handle it
			const def = deps.templating.findTemplateById(templateKey);
			// Skip generic edit flow for hidden templates (e.g., members.assignee) or templates without params
			if (!def || def.hiddenFromDynamicCommands || !def.hasParams) {
				return; // allow task-assignment and other handlers to receive the click
			}

			// Current file path is required to persist changes
			if (!filePath) return;

			// We will handle this double-click: cancel default and stop propagation
			evt.preventDefault();
			evt.stopPropagation();
			// @ts-ignore
			evt.stopImmediatePropagation?.();

			const instanceId =
				wrapper.getAttribute("data-template-wrapper") || undefined;

			const lineHint0 =
				typeof getLineHint0 === "function" ? getLineHint0() : null;

			await editTemplateParamsOnDashboard(
				{
					wrapperEl: wrapper,
					templateKey,
					instanceId,
				},
				{
					filePath,
					lineHint0: lineHint0 ?? null,
				},
				{
					...deps,
					notices, // default to Obsidian Notice if not provided
				}
			);
		} catch (err) {
			const msg = `Template edit failed: ${String(
				(err as Error)?.message ?? err
			)}`;
			if (useObsidianNotice) new Notice(msg);
			else deps.notices?.error?.(msg);
		}
	};

	// Use capture to intercept double-clicks before default behaviors in the editor
	registerDomEvent(viewContainer, "dblclick", onDblClick, { capture: true });

	// Obsidian will auto-clean via registerDomEvent. Return no-op for interface symmetry.
	return () => {};
}