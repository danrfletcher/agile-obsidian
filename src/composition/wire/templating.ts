import type { App, MarkdownView, Plugin } from "obsidian";
import { wireTemplatingDomHandlers } from "@features/templating-engine";
import { wireTemplatingUxShortcutsDomHandlers } from "@features/templating-ux-shortcuts";
import type { TaskIndexPort } from "@features/templating-engine";

/**
 * Wires templating DOM handlers and UX shortcuts for the active view.
 * Note: underlying features manage their own cleanup via plugin.register; this function
 * is intentionally thin to avoid duplicating internal lifecycles.
 */
export function wireTemplatingForView(
	app: App,
	view: MarkdownView,
	plugin: Plugin,
	ports: { taskIndex: TaskIndexPort }
): void {
	try {
		wireTemplatingDomHandlers(app, view, plugin, {
			taskIndex: ports.taskIndex,
		});
	} catch {}
	try {
		wireTemplatingUxShortcutsDomHandlers(app, view, plugin);
	} catch {}
}
