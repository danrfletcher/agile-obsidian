import type { NoticePort } from "./ports";
import type {
	TemplateParams,
	ParamsSchema as EditorParamsSchema,
} from "../domain/types";
import type {
	ParamsSchema as EngineParamsSchema,
} from "@features/templating-engine";
import { validateAndSanitizeParams } from "../domain/validation";

export type ParamsTemplatingPorts = {
	findTemplateById: (
		id: string
	) =>
		| {
				id: string;
				hasParams?: boolean;
				hiddenFromDynamicCommands?: boolean;
				paramsSchema?: EngineParamsSchema;
		  }
		| undefined;

	showSchemaModal: (
		templateId: string,
		schema: EngineParamsSchema,
		isEdit: boolean
	) => Promise<TemplateParams | undefined>;

	showJsonModal: (
		templateId: string,
		initialJson: string
	) => Promise<TemplateParams | undefined>;
};

function toEditorParamsSchema(
	schema?: EngineParamsSchema
): EditorParamsSchema | undefined {
	if (!schema) return undefined;

	return {
		title: schema.title,
		description: schema.description,
		titles: schema.titles,
		fields: schema.fields?.map((field) => ({
			name: field.name,
			label: field.label,
			// Validation uses this `type` to decide coercion; we keep it generic
			// so values are treated as-is (string-ish) by default.
			type: "any",
			placeholder: field.placeholder,
			defaultValue: field.defaultValue,
			description: field.description,
			required: field.required,
			options: field.options,
		})),
	};
}

/**
 * Unified parameter request flow for both "create" and "edit".
 * - Determines schema vs JSON modal
 * - Prefills defaults based on provided prefill map (strings)
 * - Validates/sanitizes against schema when provided
 * - Returns clean params or undefined if user cancels
 */
export async function requestTemplateParams(
	ports: ParamsTemplatingPorts,
	templateKey: string,
	prefill: Record<string, unknown> | undefined,
	isEdit: boolean,
	notices?: NoticePort
): Promise<TemplateParams | undefined> {
	const def = ports.findTemplateById(templateKey);
	if (!def) {
		notices?.warn?.(`Unknown template: ${templateKey}`);
		return undefined;
	}
	if (def.hiddenFromDynamicCommands) {
		// Assignee etc: do not open generic param modals
		return undefined;
	}
	if (!def.hasParams) {
		// Nothing to collect
		return {};
	}

	const prefillObj = prefill ?? {};
	const asString = (v: unknown): string =>
		v == null ? "" : typeof v === "string" ? v : String(v);

	let params: TemplateParams | undefined;

	if (
		def.paramsSchema &&
		Array.isArray(def.paramsSchema.fields) &&
		def.paramsSchema.fields.length > 0
	) {
		// Merge defaults into schema for better UX (editing shows current values)
		const merged: EngineParamsSchema = {
			...def.paramsSchema,
			fields: def.paramsSchema.fields.map((f) => ({
				...f,
				defaultValue:
					prefillObj[f.name] != null
						? asString(prefillObj[f.name])
						: f.defaultValue,
			})),
		};

		params = await ports.showSchemaModal(templateKey, merged, isEdit);
	} else {
		const json = JSON.stringify(prefillObj, null, 2);
		params = await ports.showJsonModal(templateKey, json);
	}

	if (!params) return undefined;

	// Validate/sanitize if there is a schema. Otherwise accept as-is.
	const validation = validateAndSanitizeParams(
		params,
		toEditorParamsSchema(def.paramsSchema)
	);
	if (!validation.ok) {
		notices?.error?.(
			`Invalid parameters: ${validation.error ?? "Unknown error"}`
		);
		return undefined;
	}
	return validation.value ?? {};
}