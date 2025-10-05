import type { App, MarkdownView, Plugin } from "obsidian";
import { processEnter } from "../app/enter-repeat-last-template";

/**
 * Wires editor-level UX shortcuts related to templating.
 * Currently: Enter-to-repeat-last-template-of-same-type on the next task line.
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

	// Keydown: Enter -> invoke UX shortcut orchestration (capture=true to precede defaults)
	const onKeyDown = (evt: KeyboardEvent) => {
		if (evt.key !== "Enter") return;
		// Allow CodeMirror to apply the line split first
		setTimeout(async () => {
			try {
				await processEnter(app, view);
			} catch {
				// Notice is handled in orchestration when needed
			}
		}, 24);
	};

	plugin.registerDomEvent(targetEl, "keydown", onKeyDown, { capture: true });
}
