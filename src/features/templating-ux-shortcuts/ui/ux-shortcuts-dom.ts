import type { App, MarkdownView, Plugin } from "obsidian";
import { processEnter } from "../app/enter-repeat-agile-template";

/**
 * Wires editor-level UX shortcuts related to templating.
 * Double-Enter-to-repeat-last-template-of-same-type on the next task line.
 *
 * We listen on keydown with capture=true and forward the event to processEnter
 * so it can decide if and when to preventDefault (only on the second Enter within window).
 */
export function wireTemplatingUxShortcutsDomHandlers(
	app: App,
	view: MarkdownView,
	plugin: Plugin
) {
	// Resolve content root for the editor
	const cmHolder = view as unknown as {
		editor?: { cm?: { contentDOM?: HTMLElement } };
	};
	const cmContent = cmHolder.editor?.cm?.contentDOM;
	const contentRoot = (cmContent ??
		view.containerEl.querySelector(".cm-content")) as HTMLElement | null;
	const targetEl: HTMLElement = contentRoot ?? view.containerEl;

	const onKeyDown = (evt: KeyboardEvent) => {
		if (evt.key !== "Enter") return;
		// Pass the event so processEnter can preventDefault on the second press (when applicable)
		void processEnter(app, view, evt);
	};

	plugin.registerDomEvent(targetEl, "keydown", onKeyDown, { capture: true });
}
