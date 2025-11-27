/* eslint-env browser */

/**
 * Templating Sequencer - Editor Click Handler
 *
 * Wires a click handler (capture=true) to show the sequencing menu when clicking on any
 * template wrapper that participates in at least one sequence. This mirrors the behavior
 * of task-assignment's floating menu: suppress Obsidian's default behavior and avoid modals.
 *
 * Update:
 * - Defer opening the menu for a short window (CLICK_DEFER_MS).
 * - If a second click occurs within this window on the same wrapper (i.e., a double-click),
 *   cancel the pending single-click menu open. This avoids colliding with the params-editor modal.
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

// Milliseconds to discriminate single vs double-click
const CLICK_DEFER_MS = 280;

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
	const maybeContentRoot =
		(cmContent ??
			view.containerEl.querySelector(".cm-content")) ?? null;
	const contentRoot =
		maybeContentRoot instanceof HTMLElement ? maybeContentRoot : null;
	const targetEl: HTMLElement = contentRoot ?? view.containerEl;

	let clickTimer: number | null = null;
	let pending: {
		wrapperEl: HTMLElement;
		x: number;
		y: number;
	} | null = null;

	const clearPending = () => {
		if (clickTimer != null) {
			window.clearTimeout(clickTimer);
			clickTimer = null;
		}
		pending = null;
	};

	const onClick = (evt: MouseEvent) => {
		try {
			const target = evt.target as HTMLElement | null;
			if (!target) return;

			// Only handle clicks on our eligible templates
			const wrapper: HTMLElement | null = target.closest(
				"span[data-template-wrapper][data-template-key]"
			);
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

			// If this is the second click in a double-click sequence, cancel pending
			if (evt.detail > 1) {
				clearPending();
				return;
			}

			// If a pending single-click exists for the same wrapper, treat this as a double-click -> cancel
			if (pending && pending.wrapperEl === wrapper) {
				clearPending();
				return;
			}

			// Schedule the single-click action to run after the double-click window has passed
			clearPending();
			pending = { wrapperEl: wrapper, x, y };
			clickTimer = window.setTimeout(() => {
				const p = pending;
				clearPending();
				if (!p) return;

				// Wrapper might have been removed; bail safely
				if (!document.contains(p.wrapperEl)) return;

				openSequencerMenuAt({
					app,
					view,
					at: { x: p.x, y: p.y },
					wrapperEl: p.wrapperEl,
				});
			}, CLICK_DEFER_MS);
		} catch {
			// ignore
		}
	};

	// Capture=true to beat default behaviors (memory-leak safe via registerDomEvent)
	plugin.registerDomEvent(targetEl, "click", onClick, { capture: true });

	// No explicit cleanup needed; Obsidian will detach registered DOM events with the plugin lifecycle.
}