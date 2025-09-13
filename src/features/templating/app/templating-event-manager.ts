// templating-event-manager.ts
import type { App, MarkdownView, Plugin } from "obsidian";
import { Notice } from "obsidian";
import type { TaskIndexPort } from "./templating-ports";
import { processClick, processEnter } from "./templating-orchestration";
import { presetTemplates } from "../domain/presets";

export function wireTemplatingDomHandlers(
	app: App,
	view: MarkdownView,
	plugin: Plugin,
	ports: { taskIndex: TaskIndexPort }
) {
	// Resolve content root
	const cmHolder = view as unknown as {
		editor?: { cm?: { contentDOM?: HTMLElement } };
	};
	const cmContent = cmHolder.editor?.cm?.contentDOM;
	const contentRoot = (cmContent ??
		view.containerEl.querySelector(".cm-content")) as HTMLElement | null;
	const targetEl: HTMLElement = contentRoot ?? view.containerEl;

	// Click-to-edit (delegate)
	const onClick = async (evt: MouseEvent) => {
		const target = evt.target as HTMLElement | null;
		if (!target) return;

		let el: HTMLElement | null = target;
		while (el) {
			if (el.hasAttribute("data-template-wrapper")) break;
			el = el.parentElement;
		}
		if (!el) return;

		// Determine which template key we clicked
		const templateKey = el.getAttribute("data-template-key") ?? "";
		if (templateKey) {
			const [group, key] = templateKey.split(".");
			const groupMap = presetTemplates as unknown as Record<
				string,
				Record<string, any>
			>;
			const def = groupMap[group]?.[key];
			if (def && def.hiddenFromDynamicCommands) {
				// Do NOT intercept this click. Let other feature handlers (e.g., task-assignment) handle it.
				return;
			}
		}

		// Otherwise, this is a normal templating click we manage
		evt.preventDefault();
		evt.stopPropagation();

		try {
			await processClick(app, el);
		} catch (err) {
			new Notice(
				`Template edit failed: ${String(
					(err as Error)?.message ?? err
				)}`
			);
		}
	};

	plugin.registerDomEvent(targetEl, "click", onClick, { capture: true });

	// Enter key (delegate)
	// Minimal delay to allow editor to apply the line split; no heavy async here.
	const onKeyDown = async (evt: KeyboardEvent) => {
		if (evt.key !== "Enter") return;

		setTimeout(async () => {
			try {
				await processEnter(app, view, ports);
			} catch (err) {
				new Notice(
					`Template insert failed: ${String(
						(err as Error)?.message ?? err
					)}`
				);
			}
		}, 24);
	};

	plugin.registerDomEvent(targetEl, "keydown", onKeyDown, { capture: true });
}
