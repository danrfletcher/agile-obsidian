/**
 * Templating Sequencer - Floating Menu
 *
 * Builds a click-triggered floating menu (like task-assignment) that:
 * - Suppresses default behavior that would expose raw HTML
 * - Shows "Forward" options (start->target) and "Back" options (reverse from "both")
 * - Calls executeSequenceMove(...) on selection
 */

import type { App, MarkdownView, Menu } from "obsidian";
import { Notice, Menu as ObsidianMenu } from "obsidian";
import { findTemplateById } from "@features/templating-engine/app/templating-service";
import {
	computeAvailableMoves,
	executeSequenceMove,
	getCurrentParamsFromWrapper,
} from "../app/sequencer-service";

function getTemplateLabel(templateId: string): string {
	const def = findTemplateById(templateId) as any;
	return (def?.label as string) || templateId;
}

/**
 * Open the Sequencer menu at a given screen position for a clicked wrapper element.
 */
export function openSequencerMenuAt(opts: {
	app: App;
	view: MarkdownView;
	at: { x: number; y: number };
	wrapperEl: HTMLElement;
}): void {
	const { app, view, at, wrapperEl } = opts;

	const currentTemplateKey =
		wrapperEl.getAttribute("data-template-key") || "";
	const instanceId = wrapperEl.getAttribute("data-template-wrapper") || null;

	if (!currentTemplateKey) return;

	const currentParams = getCurrentParamsFromWrapper(wrapperEl);
	const { forward, backward } = computeAvailableMoves(
		currentTemplateKey,
		currentParams
	);

	if (forward.length === 0 && backward.length === 0) {
		new Notice("No available sequence moves for this template.");
		return;
	}

	const menu: Menu = new ObsidianMenu();

	// Helper to add a section header (disabled item) + optional separator
	const addSectionHeader = (title: string, first: boolean) => {
		if (!first) menu.addSeparator();
		menu.addItem((i) => {
			i.setTitle(title);
			// @ts-ignore - setDisabled is not public API; use a label-like item by not wiring clicks
		});
	};

	let isFirst = true;

	if (forward.length > 0) {
		addSectionHeader("Move Forward", isFirst);
		isFirst = false;
		for (const seq of forward) {
			const toLabel = getTemplateLabel(seq.targetTemplate);
			const display = seq.label ? `${seq.label} → ${toLabel}` : toLabel;

			menu.addItem((i) => {
				i.setTitle(display);
				i.onClick(async () => {
					try {
						await executeSequenceMove({
							app,
							view,
							wrapperEl,
							currentTemplateKey,
							currentInstanceId: instanceId,
							sequence: seq,
							direction: "forward",
						});
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

	if (backward.length > 0) {
		addSectionHeader("Move Back", isFirst);
		isFirst = false;
		for (const seq of backward) {
			const toLabel = getTemplateLabel(seq.startTemplate);
			const display = seq.label ? `${seq.label} → ${toLabel}` : toLabel;

			menu.addItem((i) => {
				i.setTitle(display);
				i.onClick(async () => {
					try {
						await executeSequenceMove({
							app,
							view,
							wrapperEl,
							currentTemplateKey,
							currentInstanceId: instanceId,
							sequence: seq,
							direction: "backward",
						});
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

	menu.showAtPosition({ x: at.x, y: at.y });
}
