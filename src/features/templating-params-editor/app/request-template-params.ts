import type { NoticePort } from "./ports";
import type { TemplateParams } from "../domain/types";
import { validateAndSanitizeParams } from "../domain/validation";

export type ParamsTemplatingPorts = {
	findTemplateById: (id: string) =>
		| {
				id: string;
				hasParams?: boolean;
				hiddenFromDynamicCommands?: boolean;
				paramsSchema?:
					| {
							title?: string;
							description?: string;
							fields?: Array<{
								name: string;
								label?: string;
								type?: string;
								placeholder?: string;
								defaultValue?: string | number | boolean | null;
								description?: string;
								required?: boolean;
								options?: Array<{
									label: string;
									value: string;
								}>;
							}>;
							titles?: { create?: string; edit?: string };
					  }
					| undefined;
		  }
		| undefined;

	showSchemaModal: (
		templateId: string,
		schema: {
			title?: string;
			description?: string;
			fields: Array<{
				name: string;
				label?: string;
				type?: "string" | "number" | "boolean" | "any" | string;
				placeholder?: string;
				defaultValue?: string | number | boolean | null;
				description?: string;
				required?: boolean;
				options?: Array<{ label: string; value: string }>;
			}>;
			titles?: { create?: string; edit?: string };
		},
		isEdit: boolean
	) => Promise<TemplateParams | undefined>;

	showJsonModal: (
		templateId: string,
		initialJson: string
	) => Promise<TemplateParams | undefined>;
};

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
		const merged = {
			...def.paramsSchema,
			fields: def.paramsSchema.fields.map((f) => ({
				...f,
				defaultValue:
					prefillObj[f.name] != null
						? asString(prefillObj[f.name])
						: f.defaultValue,
			})),
		};

		params = await ports.showSchemaModal(
			templateKey,
			merged as any,
			isEdit
		);
	} else {
		const json = JSON.stringify(prefillObj, null, 2);
		params = await ports.showJsonModal(templateKey, json);
	}

	if (!params) return undefined;

	// Validate/sanitize if there is a schema. Otherwise accept as-is.
	const validation = validateAndSanitizeParams(
		params,
		def.paramsSchema as any
	);
	if (!validation.ok) {
		notices?.error?.(
			`Invalid parameters: ${validation.error ?? "Unknown error"}`
		);
		return undefined;
	}
	return validation.value ?? {};
}
