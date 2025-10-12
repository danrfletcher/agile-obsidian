/**
 * Templating Sequencer - Editor Click Handler
 *
 * Wires a click handler (capture=true) to show the sequencing menu when clicking on any
 * template wrapper that participates in at least one sequence. This mirrors the behavior
 * of task-assignment's floating menu: suppress Obsidian's default behavior and avoid modals.
 */

import type { App, MarkdownView, Plugin } from "obsidian";
import { openSequencerMenuAt } from "./menu";
import { presetSequences } from "../domain/preset-sequences";

function makeEligibleTemplateSet(): Set<string> {
	const s = new Set<string>();
	for (const seq of presetSequences) {
		s.add(seq.startTemplate);
		if (seq.direction === "both") {
			s.add(seq.targetTemplate);
		}
	}
	return s;
}

const ELIGIBLE_TEMPLATES = makeEligibleTemplateSet();

/**
 * Wire the sequencer menu on click for the current MarkdownView.
 * Use plugin.registerDomEvent for lifecycle awareness to prevent leaks.
 */
export function wireTemplatingSequencerDomHandlers(
	app: App,
	view: MarkdownView,
	plugin: Plugin
) {
	// Prefer CodeMirror content DOM when present
	const cmHolder = view as unknown as {
		editor?: { cm?: { contentDOM?: HTMLElement } };
	};
	const cmContent = cmHolder.editor?.cm?.contentDOM;
	const contentRoot = (cmContent ??
		view.containerEl.querySelector(".cm-content")) as HTMLElement | null;
	const targetEl: HTMLElement = contentRoot ?? view.containerEl;

	const onClick = (evt: MouseEvent) => {
		try {
			const target = evt.target as HTMLElement | null;
			if (!target) return;

			// Only handle clicks on our eligible templates
			const wrapper = target.closest(
				"span[data-template-wrapper][data-template-key]"
			) as HTMLElement | null;
			if (!wrapper) return;

			const tpl = String(wrapper.getAttribute("data-template-key") || "");
			if (!ELIGIBLE_TEMPLATES.has(tpl)) return;

			// Suppress default click (prevent raw HTML reveal) and other handlers
			evt.preventDefault();
			evt.stopPropagation();
			// @ts-ignore
			evt.stopImmediatePropagation?.();

			const x = evt.clientX;
			const y = evt.clientY;

			openSequencerMenuAt({
				app,
				view,
				at: { x, y },
				wrapperEl: wrapper,
			});
		} catch {
			// ignore
		}
	};

	// Capture=true to beat default behaviors (memory-leak safe via registerDomEvent)
	plugin.registerDomEvent(targetEl, "click", onClick, { capture: true });

	// No explicit cleanup needed; Obsidian will detach registered DOM events with the plugin lifecycle.
}
