import type { App, MarkdownView, Plugin } from "obsidian";
import { wireTemplatingDomHandlers } from "@features/templating-engine";
import { wireTemplatingUxShortcutsDomHandlers } from "@features/templating-ux-shortcuts";
import { wireTemplatingSequencerDomHandlers } from "@features/templating-sequencer";
import type { TaskIndexPort } from "@features/templating-engine";

/**
 * Wires templating DOM handlers, templating UX shortcuts, and templating sequencer
 * for the active MarkdownView.
 * Underlying features manage their own cleanup via plugin.register.
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
	try {
		// NEW: floating sequencing menu for note editor
		wireTemplatingSequencerDomHandlers(app, view, plugin);
	} catch {}
}
