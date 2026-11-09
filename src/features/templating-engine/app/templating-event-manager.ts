import type { App, MarkdownView, Plugin } from "obsidian";
import { TFile } from "obsidian";

import {
	attachEditorTemplatingHandler,
	type TemplatingPorts,
} from "@features/templating-params-editor";

import {
	prefillTemplateParams as realPrefillTemplateParams,
	findTemplateById as realFindTemplateById,
} from "./templating-service";
import {
	showSchemaModal as realShowSchemaModal,
	showJsonModal as realShowJsonModal,
} from "@features/templating-params-editor";

// Render with workflows (e.g. on-demand artefact-type lookup for Link to Artifact)
import { renderTemplateWithWorkflows } from "./render-with-workflows";
import type { ParamsSchema } from "../domain/types";

/**
 * Wire editor DOM handlers for templating, including slash-command insertion modal.
 *
 * Rendering is async: for templates that declare insertWorkflows (Link to Artifact),
 * renderTemplateOnly awaits the workflows against the params it is given, so the chip
 * is written with the type of the *current* blockRef. State is per call; nothing is
 * cached between renders.
 */
export function wireTemplatingDomHandlers(
	app: App,
	view: MarkdownView,
	plugin: Plugin
) {
	// Resolve content root
	const cmHolder = view as {
		editor?: { cm?: { contentDOM?: HTMLElement } };
	};
	const cmContent = cmHolder.editor?.cm?.contentDOM;
	const rawContentRoot = cmContent ?? view.containerEl.querySelector(".cm-content");
	const contentRoot =
		rawContentRoot instanceof HTMLElement ? rawContentRoot : null;
	const targetEl: HTMLElement = contentRoot ?? view.containerEl;

	const templating: TemplatingPorts = {
		findTemplateById: (id) => {
			const def = realFindTemplateById(id);
			return def
				? {
						id: def.id,
						hasParams: !!def.hasParams,
						hiddenFromDynamicCommands:
							def.hiddenFromDynamicCommands,
						// Preserve full params schema so modals have type, label, placeholder, options, etc.
						paramsSchema: def.paramsSchema
							? {
									...def.paramsSchema,
									fields:
										def.paramsSchema.fields?.map((f) => ({
											...f,
										})) ?? [],
							  }
							: undefined,
				  }
				: undefined;
		},

		prefillTemplateParams: (templateId, wrapperEl) =>
			realPrefillTemplateParams(templateId, wrapperEl),

		// Awaits the template's insertWorkflows (if any) against exactly the params being
		// rendered, so the type comes from the blockRef the user just saved. Lookup
		// failures resolve to "no type"; they never reject or show a notice.
		renderTemplateOnly: (
			templateId: string,
			params: Record<string, unknown>,
			ctx?: { sourcePath?: string }
		) =>
			renderTemplateWithWorkflows(
				app,
				templateId,
				params,
				ctx?.sourcePath ?? filePath()
			),

		showSchemaModal: (
			templateId: string,
			schema: ParamsSchema,
			isEdit: boolean
		) => {
			const normalizedSchema: ParamsSchema = {
				...schema,
				fields:
					schema.fields?.map((f) => ({
						...f,
					})) ?? [],
			};

			return realShowSchemaModal(
				app,
				templateId,
				normalizedSchema,
				isEdit
			);
		},

		showJsonModal: (
			templateId: string,
			initialJson: string
		) => realShowJsonModal(app, templateId, initialJson),
	};

	// Vault adapter for file I/O (used by params-editor for wrapper replacement)
	const vault = {
		readFile: async (path: string): Promise<string> => {
			const af = app.vault.getAbstractFileByPath(path);
			if (!af) throw new Error(`File not found: ${path}`);
			if (!(af instanceof TFile)) {
				throw new Error(`Not a file: ${path}`);
			}
			return app.vault.read(af);
		},
		writeFile: async (path: string, content: string): Promise<void> => {
			const af = app.vault.getAbstractFileByPath(path);
			if (!af) throw new Error(`File not found: ${path}`);
			if (!(af instanceof TFile)) {
				throw new Error(`Not a file: ${path}`);
			}
			await app.vault.modify(af, content);
		},
	};

	// In the editor context, Obsidian will refresh the view automatically after vault.modify.
	const refresh = {
		refreshForFile: async (_filePath?: string | null) => {},
	};

	// Determine file path and line hint resolver for the current view
	// Resolved at click time: the same view can navigate to another note.
	const filePath = () => view.file?.path || "";
	const getLineHint0 = (): number | null => {
		try {
			const ln = view.editor?.getCursor?.().line;
			return typeof ln === "number" ? ln : null;
		} catch {
			return null;
		}
	};

	// Attach the editor click handler (capture=true to beat default behaviors)
	attachEditorTemplatingHandler({
		app,
		viewContainer: targetEl,
		registerDomEvent: (
			el: HTMLElement | Document | Window,
			type: string,
			handler: (evt: MouseEvent) => void,
			options?: boolean | AddEventListenerOptions
		) => {
			// Bridge to Obsidian's overloaded registerDomEvent without using `any`.
			// All overloads expect a callback with `this: HTMLElement`, so we cast
			// the handler accordingly and, in the HTMLElement case, explicitly
			// narrow `el` to HTMLElement to avoid union overload ambiguity.
			if (el === window) {
				plugin.registerDomEvent(
					window,
					type as keyof WindowEventMap,
					handler as (this: HTMLElement, ev: MouseEvent) => unknown,
					options
				);
			} else if (el instanceof Document) {
				plugin.registerDomEvent(
					el,
					type as keyof DocumentEventMap,
					handler as (this: HTMLElement, ev: MouseEvent) => unknown,
					options
				);
			} else {
				plugin.registerDomEvent(
					el as HTMLElement,
					type as keyof HTMLElementEventMap,
					handler as (this: HTMLElement, ev: MouseEvent) => unknown,
					options
				);
			}
		},
		deps: {
			templating,
			vault,
			refresh,
		},
		filePath,
		getLineHint0,
		useObsidianNotice: true,
	});
}