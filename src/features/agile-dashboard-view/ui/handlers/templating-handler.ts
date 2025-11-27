// ./src/features/agile-dashboard-view/ui/handlers/templating-handler.ts
/**
 * Adapter: delegates templating param editing handler to the refactored, wiring-agnostic
 * templating-params-editor module. Wires in the Agile Dashboard event bus and
 * the required ports (templating, vault, refresh, notices).
 */

import type { App } from "obsidian";
import {
	attachDashboardTemplatingHandler as attachGenericTemplatingHandler,
	type TemplatingPorts,
	type NoticePort,
} from "@features/templating-params-editor";

import { createPathFileRepository } from "@platform/obsidian";
import {
	prefillTemplateParams as realPrefillTemplateParams,
	renderTemplateOnly as realRenderTemplateOnly,
	findTemplateById as realFindTemplateById,
} from "@features/templating-engine/app/templating-service";
import {
	showSchemaModal as realShowSchemaModal,
	showJsonModal as realShowJsonModal,
} from "@features/templating-params-editor";

import { eventBus } from "../../app/event-bus";

type RegisterDomEvent = (
	el: HTMLElement | Window | Document,
	type: string,
	handler: (evt: Event) => void,
	options?: AddEventListenerOptions | boolean
) => void;

export interface TemplatingHandlerOptions {
	app: App;
	viewContainer: HTMLElement;
	registerDomEvent: RegisterDomEvent;

	// Dashboard refresh hook
	refreshForFile: (filePath?: string | null) => Promise<void>;

	// Optional notices adapter; if omitted, the generic handler will default to Obsidian Notice
	notices?: NoticePort;

	// If true (default), allow the generic handler to use Obsidian Notice as fallback
	useObsidianNotice?: boolean;
}

/**
 * Attach the dashboard templating handler using the refactored feature.
 * This implementation:
 * - Uses platform/obsidian's createPathFileRepository for VaultPort compatibility
 * - Wires templating ports directly to templating-engine/editor functions without cross-casting schema types
 */
export function attachDashboardTemplatingHandler(
	opts: TemplatingHandlerOptions
): void {
	const {
		app,
		viewContainer,
		registerDomEvent,
		refreshForFile,
		notices,
		useObsidianNotice = true,
	} = opts;

	// Wire templating ports:
	// - findTemplateById adapts engine TemplateDefinition to the strict port type (coerce hasParams to boolean)
	// - showSchemaModal expects the EDITOR schema type -> pass through directly (it uses engine ParamsSchema)
	// - prefill/render passthrough to templating-engine service
	const templating: TemplatingPorts = {
		findTemplateById: (id) => {
			const def = realFindTemplateById(id);
			if (!def) return undefined;
			return {
				id: def.id,
				hasParams: !!def.hasParams,
				hiddenFromDynamicCommands: def.hiddenFromDynamicCommands,
				paramsSchema: def.paramsSchema
					? {
							...def.paramsSchema,
							fields:
								def.paramsSchema.fields?.map((f) => ({
									...f,
								})) ?? [],
					  }
					: undefined,
			};
		},

		prefillTemplateParams: (templateId, wrapperEl) =>
			realPrefillTemplateParams(templateId, wrapperEl),

		renderTemplateOnly: (templateId, params) =>
			realRenderTemplateOnly(templateId, params),

		// IMPORTANT: Show schema modal expects the editor's rich (engine) ParamsSchema; pass through directly
		showSchemaModal: async (templateId, schema, isEdit) =>
			realShowSchemaModal(
				app,
				templateId,
				{
					...schema,
					fields: schema.fields?.map((f) => ({ ...f })) ?? [],
				},
				isEdit
			),

		showJsonModal: (templateId, initialJson) =>
			realShowJsonModal(app, templateId, initialJson),
	};

	// Use platform/obsidian file repository as VaultPort (fileExists optional)
	const repo = createPathFileRepository(app);
	const vault = {
		readFile: (...args: Parameters<typeof repo.readFile>) =>
			repo.readFile(...args),
		writeFile: (...args: Parameters<typeof repo.writeFile>) =>
			repo.writeFile(...args),
	};

	// Bridge our generic registerDomEvent (Event) to the templating editor's MouseEvent-specific API.
	const registerDomEventForMouse = (
		el: HTMLElement | Window | Document,
		type: string,
		handler: (evt: MouseEvent) => void,
		options?: AddEventListenerOptions | boolean
	): void => {
		const wrappedHandler = (evt: Event): void => {
			handler(evt as MouseEvent);
		};
		registerDomEvent(el, type, wrappedHandler, options);
	};

	attachGenericTemplatingHandler({
		app,
		viewContainer,
		registerDomEvent: registerDomEventForMouse,
		deps: {
			templating,
			vault,
			refresh: { refreshForFile },
			notices, // allow undefined; handler will default to Obsidian Notice if allowed
			eventBus,
		},
		useObsidianNotice,
	});
}