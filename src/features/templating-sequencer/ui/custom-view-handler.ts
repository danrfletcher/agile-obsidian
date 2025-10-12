/**
 * Templating Sequencer - Generic Custom View Handler
 *
 * Attaches a click-capture handler to a custom view container to:
 * - Suppress default behavior (avoid exposing raw HTML on click)
 * - Build a floating menu of sequence moves (forward/back)
 * - Map variables, prompt for additional properties, render, and overwrite inner HTML in the source note
 * - Refresh the custom view via provided callback
 *
 * This is generic and can be used by any custom view (e.g., Agile Dashboard).
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
		handler: (evt: any) => void,
		options?: AddEventListenerOptions | boolean
	) => void;

	// Called after successful overwrite to refresh any view state
	refreshForFile: (filePath?: string | null) => Promise<void>;
}

function getTemplateLabel(templateId: string): string {
	const def = findTemplateById(templateId) as any;
	return (def?.label as string) || templateId;
}

export function attachCustomViewTemplatingSequencerHandler(
	opts: CustomViewSequencerHandlerOptions
): void {
	const { app, viewContainer, registerDomEvent, refreshForFile } = opts;

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

			// Resolve filePath & optional line hint from nearest task LI
			const li =
				wrapper.closest("li[data-file-path]") ||
				wrapper.closest("[data-file-path]");
			const liEl = li as HTMLElement | null;
			const filePath = liEl?.getAttribute("data-file-path") || "";
			if (!filePath) {
				new Notice(
					"Unable to determine source file for this template."
				);
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

			const addSectionHeader = (title: string, first: boolean) => {
				if (!first) menu.addSeparator();
				menu.addItem((i) => {
					i.setTitle(title);
				});
			};

			let first = true;

			if (forward.length > 0) {
				addSectionHeader("Move Forward", first);
				first = false;
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
			}

			if (backward.length > 0) {
				addSectionHeader("Move Back", first);
				first = false;
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

			menu.showAtPosition({ x: evt.clientX, y: evt.clientY });
		} catch {
			// ignore
		}
	};

	// Capture=true to intercept before Obsidian's default link/HTML click behaviors
	registerDomEvent(viewContainer, "click", onClick, { capture: true });

	// Optional: also support context menu open
	registerDomEvent(
		viewContainer,
		"contextmenu",
		(ev: MouseEvent) => {
			const target = ev.target as HTMLElement | null;
			const wrapper = target?.closest(
				"span[data-template-wrapper][data-template-key]"
			) as HTMLElement | null;
			if (!wrapper) return;
			onClick(ev);
		},
		{ capture: true }
	);
}
