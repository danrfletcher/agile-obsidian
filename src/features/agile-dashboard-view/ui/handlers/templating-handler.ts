/**
 * Adapter: delegates templating param editing handler to the refactored, wiring-agnostic
 * templating-params-editor module. Wires in the Agile Dashboard event bus and
 * the required ports (templating, vault, refresh, notices), with type adapters.
 *
 */

import type { App } from "obsidian";
import {
	attachDashboardTemplatingHandler as attachGenericTemplatingHandler,
	type TemplatingPorts,
	type NoticePort,
	type TemplateParams, // Editor params type
	type TemplateDef as EditorTemplateDef, // Editor template def type
} from "@features/templating-params-editor";
import type {
	ParamsSchema as EditorParamsSchema, // Editor schema type
} from "@features/templating-params-editor/domain/types";

import { createPathFileRepository } from "@platform/obsidian";
import {
	prefillTemplateParams as realPrefillTemplateParams,
	renderTemplateOnly as realRenderTemplateOnly,
	findTemplateById as realFindTemplateById,
} from "@features/templating-engine/app/templating-service";
import { showSchemaModal as realShowSchemaModal } from "@features/templating-params-editor";
import { showJsonModal as realShowJsonModal } from "@features/templating-params-editor";

// Templating module types (to adapt from/to)
import type {
	TemplateDefinition as TmplTemplateDef,
	ParamsSchema as TmplParamsSchema,
	ParamsSchemaField as TmplSchemaField,
	ParamInputType as TmplParamInputType,
} from "@features/templating-engine/domain/types";

import { eventBus } from "../../app/event-bus";

type RegisterDomEvent = (
	el: HTMLElement | Window | Document,
	type: string,
	handler: (evt: any) => void,
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
 * Map templating module's ParamInputType to the editor's simplified type.
 * Unknowns map to "any".
 */
function mapParamInputTypeToEditor(
	t?: TmplParamInputType
): "string" | "number" | "boolean" | "any" | undefined {
	if (!t) return undefined;
	const v = String(t).toLowerCase();
	if (v.includes("number")) return "number";
	if (v.includes("bool") || v.includes("toggle") || v.includes("check"))
		return "boolean";
	if (
		v.includes("text") ||
		v.includes("string") ||
		v === "input" ||
		v.includes("area")
	)
		return "string";
	return "any";
}

/**
 * Adapt a templating module schema to the editor schema type.
 */
function adaptSchemaToEditor(
	schema: TmplParamsSchema | undefined
): EditorParamsSchema | undefined {
	if (!schema || !Array.isArray(schema.fields)) return undefined;
	const fields: EditorParamsSchema["fields"] = [];
	for (const f of schema.fields) {
		fields.push({
			name: f.name,
			required: f.required,
			defaultValue:
				typeof f.defaultValue === "string"
					? f.defaultValue
					: (f.defaultValue as unknown as string | undefined),
			type: mapParamInputTypeToEditor(f.type),
		});
	}
	return { fields };
}

/**
 * Adapt the editor schema to the templating module schema type.
 * We intentionally omit "type" to avoid enum coupling; the templating UI can infer/default.
 */
function adaptSchemaToTemplating(schema: EditorParamsSchema): TmplParamsSchema {
	const fields: TmplSchemaField[] = [];
	for (const f of schema.fields) {
		const out: TmplSchemaField = {
			name: f.name,
			required: f.required,
			defaultValue: f.defaultValue,
			// Note: omit "type" to avoid enum mismatches
		} as TmplSchemaField;
		fields.push(out);
	}
	return { fields };
}

/**
 * Adapt templating module's TemplateDefinition to the editor's TemplateDef.
 */
function adaptTemplateDefToEditor(
	def: TmplTemplateDef | undefined
): EditorTemplateDef | undefined {
	if (!def) return undefined;
	return {
		id: def.id,
		hasParams: !!def.hasParams, // ensure boolean
		hiddenFromDynamicCommands: def.hiddenFromDynamicCommands,
		paramsSchema: adaptSchemaToEditor(def.paramsSchema),
	};
}

/**
 * Attach the dashboard templating handler using the refactored feature.
 * This implementation:
 * - Uses platform/obsidian's createPathFileRepository for VaultPort compatibility
 * - Drops legacy infra adapters
 * - Lets the feature's UI handler default to Obsidian Notice when no notices are provided
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

	// Wire templating ports by wrapping the existing templating service and modal UIs.
	const templating: TemplatingPorts = {
		findTemplateById: (id) =>
			adaptTemplateDefToEditor(realFindTemplateById(id)),
		prefillTemplateParams: (templateId, wrapperEl) =>
			realPrefillTemplateParams(templateId, wrapperEl) as TemplateParams,
		renderTemplateOnly: (templateId, params) =>
			realRenderTemplateOnly(templateId, params),
		showSchemaModal: async (templateId, schema, isEdit) => {
			const schemaForTemplating: TmplParamsSchema =
				adaptSchemaToTemplating(schema);
			const result = await realShowSchemaModal(
				app,
				templateId,
				schemaForTemplating,
				isEdit
			);
			return result as TemplateParams | undefined;
		},
		showJsonModal: (templateId, initialJson) =>
			realShowJsonModal(app, templateId, initialJson) as Promise<
				TemplateParams | undefined
			>,
	};

	// Use platform/obsidian file repository as VaultPort.
	// Note: VaultPort.fileExists is optional; feature code will fall back to read-try/catch if absent.
	const repo = createPathFileRepository(app);
	const vault = {
		readFile: repo.readFile,
		writeFile: repo.writeFile,
		// no fileExists; optional by design
	};

	attachGenericTemplatingHandler({
		app,
		viewContainer,
		registerDomEvent,
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
