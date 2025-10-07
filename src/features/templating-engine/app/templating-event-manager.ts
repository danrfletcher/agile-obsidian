// templating-event-manager.ts
import type { App, MarkdownView, Plugin } from "obsidian";
import type { TaskIndexPort } from "./templating-ports";

// Use the new editor click handler (note context)
import {
	attachEditorTemplatingHandler,
	type TemplatingPorts,
} from "@features/templating-params-editor";

import {
	prefillTemplateParams as realPrefillTemplateParams,
	renderTemplateOnly as realRenderTemplateOnly,
	findTemplateById as realFindTemplateById,
} from "./templating-service";
import { showSchemaModal as realShowSchemaModal } from "@features/templating-params-editor";
import { showJsonModal as realShowJsonModal } from "@features/templating-params-editor";

export function wireTemplatingDomHandlers(
	app: App,
	view: MarkdownView,
	plugin: Plugin,
	_ports: { taskIndex: TaskIndexPort }
) {
	// Resolve content root
	const cmHolder = view as unknown as {
		editor?: { cm?: { contentDOM?: HTMLElement } };
	};
	const cmContent = cmHolder.editor?.cm?.contentDOM;
	const contentRoot = (cmContent ??
		view.containerEl.querySelector(".cm-content")) as HTMLElement | null;
	const targetEl: HTMLElement = contentRoot ?? view.containerEl;

	// Adapt templating ports for the editor handler
	const templating: TemplatingPorts = {
		findTemplateById: (id) => {
			const def = realFindTemplateById(id);
			return def
				? {
						id: def.id,
						hasParams: !!def.hasParams,
						hiddenFromDynamicCommands:
							def.hiddenFromDynamicCommands,
						paramsSchema: def.paramsSchema
							? {
									...def.paramsSchema,
									fields:
										def.paramsSchema.fields?.map((f) => ({
											name: f.name,
											required: f.required,
											defaultValue:
												typeof f.defaultValue ===
												"string"
													? f.defaultValue
													: (f.defaultValue as unknown as
															| string
															| undefined),
										})) ?? [],
							  }
							: undefined,
				  }
				: undefined;
		},
		prefillTemplateParams: (templateId, wrapperEl) =>
			realPrefillTemplateParams(templateId, wrapperEl),
		renderTemplateOnly: (templateId, params) =>
			realRenderTemplateOnly(templateId, params),
		showSchemaModal: async (templateId, schema, isEdit) => {
			const result = await realShowSchemaModal(
				app,
				templateId,
				{
					...schema,
					fields:
						schema.fields?.map((f) => ({
							...f,
						})) ?? [],
				} as any,
				isEdit
			);
			return result as any;
		},
		showJsonModal: (templateId, initialJson) =>
			realShowJsonModal(app, templateId, initialJson) as Promise<any>,
	};

	// Vault adapter for file I/O
	const vault = {
		readFile: async (path: string) => {
			const af = (app.vault as any).getAbstractFileByPath(path);
			if (!af) throw new Error(`File not found: ${path}`);
			return (app.vault as any).read(af);
		},
		writeFile: async (path: string, content: string) => {
			const af = (app.vault as any).getAbstractFileByPath(path);
			if (!af) throw new Error(`File not found: ${path}`);
			await (app.vault as any).modify(af, content);
		},
	};

	// In the editor context, Obsidian will refresh the view automatically after vault.modify.
	const refresh = {
		refreshForFile: async (_filePath?: string | null) => {},
	};

	// Determine file path and line hint resolver for the current view
	const filePath = view.file?.path || "";
	const getLineHint0 = () => {
		try {
			const ln = (view as any)?.editor?.getCursor?.()?.line;
			return typeof ln === "number" ? ln : null;
		} catch {
			return null;
		}
	};

	// Attach the editor click handler (capture=true to beat default behaviors)
	attachEditorTemplatingHandler({
		app,
		viewContainer: targetEl,
		// Minimal any-cast wrapper to avoid overload + parser issues
		registerDomEvent: (el, type, handler, options) => {
			(plugin.registerDomEvent as any)(
				el as any,
				type as any,
				handler as any,
				options as any
			);
		},
		deps: {
			templating,
			vault,
			refresh,
			// notices omitted to fall back to Obsidian Notice
		},
		filePath,
		getLineHint0,
		useObsidianNotice: true,
	});
}
