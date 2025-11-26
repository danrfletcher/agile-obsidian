/**
 * Templating Sequencer - Generic Custom View Handler
 *
 * Attaches a click-capture handler to a custom view container to:
 * - Suppress default behavior (avoid exposing raw HTML on click)
 * - Build a floating menu of sequence moves (forward/back) without section headers
 * - Map variables, prompt for additional properties, render, and overwrite inner HTML in the source note
 * - Refresh the custom view via provided callback
 *
 * Update:
 * - Defer opening the menu (CLICK_DEFER_MS). If a second click lands within this window on the
 *   same wrapper (i.e., a double-click), cancel the pending menu open. This ensures that when a
 *   params-editor modal opens on double-click, no sequencer menu (or Notice) flashes.
 * - Right-click context menu remains immediate and unchanged.
 * - Removed "Move Forward" and "Move Back" headers; when both groups exist, a separator is used.
 */

import type { App, Menu } from "obsidian";
import { Notice, Menu as ObsidianMenu } from "obsidian";
import { findTemplateById } from "@features/templating-engine/app/templating-service";
import {
	computeAvailableMoves,
	executeSequenceMoveOnFile,
	getCurrentParamsFromWrapper,
} from "../app/sequencer-service";

export interface CustomViewSequencerHandlerOptions {
	app: App;
	viewContainer: HTMLElement;
	// Use host's registerDomEvent for lifecycle-aware listener management
	registerDomEvent: (
		el: HTMLElement | Window | Document,
		type: string,
		handler: (evt: MouseEvent) => void,
		options?: AddEventListenerOptions | boolean
	) => void;

	// Called after successful overwrite to refresh any view state
	refreshForFile: (filePath?: string | null) => Promise<void>;
}

type TemplateWithOptionalLabel = {
	label?: string;
};

function getTemplateLabel(templateId: string): string {
	const def = findTemplateById(templateId) as TemplateWithOptionalLabel | undefined;
	return def?.label ?? templateId;
}

// Discriminate single vs double-click
const CLICK_DEFER_MS = 280;

export function attachCustomViewTemplatingSequencerHandler(
	opts: CustomViewSequencerHandlerOptions
): void {
	const { app, viewContainer, registerDomEvent, refreshForFile } = opts;

	let clickTimer: number | null = null;
	let pending: {
		wrapper: HTMLElement;
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

	const actuallyOpenMenu = (wrapper: HTMLElement, x: number, y: number) => {
		// Wrapper might have been removed; bail safely
		if (!document.contains(wrapper)) return;

		// Resolve filePath & optional line hint from nearest task LI
		const li =
			wrapper.closest("li[data-file-path]") ||
			wrapper.closest("[data-file-path]");
		const liEl = li as HTMLElement | null;
		const filePath = liEl?.getAttribute("data-file-path") || "";
		if (!filePath) {
			new Notice("Unable to determine source file for this template.");
			return;
		}
		const lineHintStr = liEl?.getAttribute("data-line") || "";
		const line0 =
			lineHintStr && /^\d+$/.test(lineHintStr)
				? parseInt(lineHintStr, 10)
				: null;

		const templateKey = wrapper.getAttribute("data-template-key") || "";
		const instanceId =
			wrapper.getAttribute("data-template-wrapper") || null;

		if (!templateKey) return;

		const currentParams = getCurrentParamsFromWrapper(wrapper);
		const { forward, backward } = computeAvailableMoves(
			templateKey,
			currentParams
		);

		if (forward.length === 0 && backward.length === 0) {
			new Notice("No available sequence moves for this template.");
			return;
		}

		const menu: Menu = new ObsidianMenu();

		let addedAny = false;

		// Forward options (no header)
		if (forward.length > 0) {
			for (const seq of forward) {
				const toLabel = getTemplateLabel(seq.targetTemplate);
				const display = seq.label
					? `${seq.label} → ${toLabel}`
					: toLabel;

				menu.addItem((i) => {
					i.setTitle(display);
					i.onClick(async () => {
						try {
							await executeSequenceMoveOnFile({
								app,
								filePath,
								line0,
								wrapperEl: wrapper,
								currentTemplateKey: templateKey,
								currentInstanceId: instanceId,
								sequence: seq,
								direction: "forward",
							});
							await refreshForFile(filePath);
						} catch (err) {
							new Notice(
								`Move failed: ${String(
									(err as Error)?.message ?? err
								)}`
							);
						}
					});
				});
			}
			addedAny = true;
		}

		// Backward options (no header). Add a separator only if both groups exist.
		if (backward.length > 0) {
			if (addedAny) menu.addSeparator();

			for (const seq of backward) {
				const toLabel = getTemplateLabel(seq.startTemplate);
				const display = seq.label
					? `${seq.label} → ${toLabel}`
					: toLabel;

				menu.addItem((i) => {
					i.setTitle(display);
					i.onClick(async () => {
						try {
							await executeSequenceMoveOnFile({
								app,
								filePath,
								line0,
								wrapperEl: wrapper,
								currentTemplateKey: templateKey,
								currentInstanceId: instanceId,
								sequence: seq,
								direction: "backward",
							});
							await refreshForFile(filePath);
						} catch (err) {
							new Notice(
								`Move failed: ${String(
									(err as Error)?.message ?? err
								)}`
							);
						}
					});
				});
			}
		}

		menu.showAtPosition({ x, y });
	};

	const onClick = (evt: MouseEvent) => {
		try {
			const target = evt.target as HTMLElement | null;
			if (!target) return;

			// We only handle clicks on template wrappers
			const wrapper = target.closest(
				"span[data-template-wrapper][data-template-key]"
			) as HTMLElement | null;
			if (!wrapper) return;

			// Suppress default behaviors to avoid exposing raw HTML / navigation
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

			// If a pending single-click exists for the same wrapper, treat as a double-click -> cancel
			if (pending && pending.wrapper === wrapper) {
				clearPending();
				return;
			}

			// Defer to allow double-click to cancel
			clearPending();
			pending = { wrapper, x, y };
			clickTimer = window.setTimeout(() => {
				const p = pending;
				clearPending();
				if (!p) return;
				actuallyOpenMenu(p.wrapper, p.x, p.y);
			}, CLICK_DEFER_MS);
		} catch {
			// ignore
		}
	};

	// Capture=true to intercept before Obsidian's default link/HTML click behaviors
	registerDomEvent(viewContainer, "click", onClick, { capture: true });

	// Optional: also support context menu open (no defer here; right-click is explicit)
	registerDomEvent(
		viewContainer,
		"contextmenu",
		(ev: MouseEvent) => {
			const target = ev.target as HTMLElement | null;
			const wrapper = target?.closest(
				"span[data-template-wrapper][data-template-key]"
			) as HTMLElement | null;
			if (!wrapper) return;

			// Prevent default context menu bubbling and open sequencer immediately
			ev.preventDefault();
			ev.stopPropagation();
			// @ts-ignore
			ev.stopImmediatePropagation?.();

			actuallyOpenMenu(wrapper, ev.clientX, ev.clientY);
		},
		{ capture: true }
	);
}