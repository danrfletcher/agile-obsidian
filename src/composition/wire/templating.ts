import type { App, MarkdownView, Plugin } from "obsidian";
import { wireTemplatingDomHandlers } from "@features/templating-engine";
import { wireTemplatingUxShortcutsDomHandlers } from "@features/templating-ux-shortcuts";
import { wireTemplatingSequencerDomHandlers } from "@features/templating-sequencer";
import type { TaskIndexPort } from "@features/templating-engine";

/**
 * Resolve the DOM element the templating handlers attach to for a view
 * (CodeMirror content DOM when present, else the view container).
 * Must resolve the same element the feature wiring functions use.
 */
function resolveEditorRoot(view: MarkdownView): HTMLElement {
	const cmHolder = view as unknown as {
		editor?: { cm?: { contentDOM?: HTMLElement } };
	};
	const cmContent = cmHolder.editor?.cm?.contentDOM;
	if (cmContent) return cmContent;
	const queried = view.containerEl.querySelector(".cm-content");
	return queried instanceof HTMLElement ? queried : view.containerEl;
}

/**
 * Creates a per-plugin-instance wirer for templating DOM handlers, templating UX
 * shortcuts, and the templating sequencer.
 *
 * Underlying features attach via plugin.registerDomEvent (removed on unload), which
 * cannot be detached individually. To avoid stacking duplicate listeners when the user
 * switches away from and back to the same editor, each (view, editor root) pair is
 * wired at most once per wirer.
 */
export function createTemplatingWirer(
	app: App,
	plugin: Plugin,
	ports: { taskIndex: TaskIndexPort }
): (view: MarkdownView) => void {
	const wiredRoots = new WeakMap<MarkdownView, HTMLElement>();

	return (view: MarkdownView): void => {
		const root = resolveEditorRoot(view);
		if (wiredRoots.get(view) === root) return;
		wiredRoots.set(view, root);

		try {
			wireTemplatingDomHandlers(app, view, plugin, {
				taskIndex: ports.taskIndex,
			});
		} catch {
			// Swallow: templating DOM handlers are optional and should not break startup.
		}
		try {
			wireTemplatingUxShortcutsDomHandlers(app, view, plugin);
		} catch {
			// Swallow: UX shortcuts are optional.
		}
		try {
			// Floating sequencing menu for note editor
			wireTemplatingSequencerDomHandlers(app, view, plugin);
		} catch {
			// Swallow: sequencer is optional.
		}
	};
}
