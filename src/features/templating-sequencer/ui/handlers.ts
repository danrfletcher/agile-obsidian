/* eslint-env browser */

/**
 * Templating Sequencer - Editor Click Handler
 *
 * Wires a click handler (capture=true) to show the sequencing menu when clicking on any
 * template wrapper that participates in at least one sequence. This is a floating
 * menu: suppress Obsidian's default behavior and avoid modals.
 *
 * Update:
 * - Defer opening the menu for a short window (CLICK_DEFER_MS).
 * - If a second click occurs within this window on the same wrapper (i.e., a double-click),
 *   cancel the pending single-click menu open. This avoids colliding with the params-editor modal.
 */

import type { App, MarkdownView, Plugin } from "obsidian";
import { openSequencerMenuAt } from "./menu";
import { isSequenceEligibleTemplate } from "../app/sequencer-service";

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
			// Read the live eligible set at event time. With the "Default templates" set
			// off, built-in chips are not eligible: leave the click completely alone.
			if (!isSequenceEligibleTemplate(tpl)) return;

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

				// The registry may have changed during the defer window (e.g. the
				// "Default templates" set was switched off): open nothing.
				const key = String(
					p.wrapperEl.getAttribute("data-template-key") || ""
				);
				if (!isSequenceEligibleTemplate(key)) return;

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

	// Obsidian detaches the DOM event with the plugin lifecycle; also cancel a pending
	// deferred menu open so nothing fires after unload.
	plugin.register(clearPending);
}