/**
 * UI click handler that intercepts clicks on template wrappers,
 * extracts context, and delegates to the application service.
 */

import type { App } from "obsidian";
import { Notice } from "obsidian";
import { editTemplateParamsOnDashboard } from "../../app/edit-template-params";
import type { AppDeps, RefreshPort } from "../../app/ports";

export interface AttachHandlerOptions {
	app: App;
	viewContainer: HTMLElement; // e.g., this.containerEl.children[1]
	registerDomEvent: (
		el: HTMLElement | Window | Document,
		type: string,
		handler: (evt: MouseEvent) => void,
		options?: AddEventListenerOptions | boolean
	) => void;

	// Required ports
	deps: AppDeps;

	// For backward compat: allow passing refresh separately in case deps.refresh is shared
	refresh?: RefreshPort;

	// Optional: provide a Notice adapter. If not provided, default to Obsidian Notice.
	useObsidianNotice?: boolean;
}

/**
 * Attach the dashboard templating handler.
 * Listens on double-click to open the edit modal.
 * Returns a cleanup no-op; Obsidian will clean up via registerDomEvent lifecycle.
 */
export function attachDashboardTemplatingHandler(
	opts: AttachHandlerOptions
): () => void {
	const {
		viewContainer,
		registerDomEvent,
		deps,
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
			const target = evt.target;
			if (!(target instanceof HTMLElement)) return;

			const wrapper = target.closest(
				"span[data-template-wrapper][data-template-key]"
			);
			if (!wrapper || !(wrapper instanceof HTMLElement)) return;

			const templateKey = wrapper.getAttribute("data-template-key") || "";
			if (!templateKey) return;

			// Resolve template def BEFORE cancelling so other handlers (e.g., assignment) can run if we skip
			const def = deps.templating.findTemplateById(templateKey);
			if (!def || def.hiddenFromDynamicCommands || !def.hasParams) {
				return; // do not cancel; let the assignment handler handle it
			}

			// We will handle this: cancel default and stop propagation
			evt.preventDefault();
			evt.stopPropagation();
			// @ts-ignore
			evt.stopImmediatePropagation?.();

			const li = wrapper.closest("li[data-file-path]");
			const filePath = li?.getAttribute("data-file-path") || "";
			if (!filePath) return;

			const lineHintStr = li?.getAttribute("data-line") || "";
			const lineHint0 =
				lineHintStr && /^\d+$/.test(lineHintStr)
					? parseInt(lineHintStr, 10)
					: null;

			await editTemplateParamsOnDashboard(
				{
					wrapperEl: wrapper,
					templateKey,
					instanceId: wrapper.getAttribute("data-template-wrapper"),
				},
				{
					filePath,
					lineHint0,
				},
				{
					...deps,
					notices,
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

	// Listen on double click instead of single click; wrap async handler to satisfy no-misused-promises
	registerDomEvent(
		viewContainer,
		"dblclick",
		(evt: MouseEvent) => {
			void onDblClick(evt);
		},
		{ capture: true }
	);
	return () => {};
}