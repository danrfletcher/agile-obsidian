/**
 * Application service for editing template parameters in dashboard context.
 * Pure orchestration that uses provided ports for all side effects.
 */

import type { AppDeps } from "./ports";
import type {
	FileContextHint,
	TemplateParams,
	WrapperDomContext,
} from "../domain/types";
import {
	locateByInstanceId,
	locateFirstByKey,
	locateNearLineByKey,
} from "../domain/span-location";
import { validateAndSanitizeParams } from "../domain/validation";

/**
 * Preserve the existing data-template-wrapper instance id in newHtml if needed.
 */
function preserveInstanceIdInHtml(
	newHtml: string,
	instanceId?: string | null
): string {
	if (!instanceId) return newHtml;
	return newHtml.replace(
		/data-template-wrapper="[^"]*"/,
		`data-template-wrapper="${instanceId}"`
	);
}

/**
 * Attempt to normalize a prefilled dropdown value to an option value so the select
 * can preselect correctly. Useful when existing content stores "USD" but options store "$".
 */
function normalizeDropdownPrefillToOptionValue(
	prefillVal: unknown,
	options?: Array<{ label: string; value: string }>
): string | undefined {
	if (!options || options.length === 0)
		return prefillVal as string | undefined;
	const raw = prefillVal == null ? "" : String(prefillVal).trim();
	if (!raw) return undefined;

	// 1) Exact match by value
	const exact = options.find((o) => String(o.value) === raw);
	if (exact) return String(exact.value);

	// 2) Case-insensitive match by label containing the raw text (tolerate code vs symbol)
	const lower = raw.toLowerCase();
	const byLabel = options.find((o) =>
		String(o.label ?? "")
			.toLowerCase()
			.includes(lower)
	);
	if (byLabel) return String(byLabel.value);

	// 3) Fallback: return the raw string (the select will not preselect)
	return raw;
}

/**
 * Orchestrates the edit flow:
 * 1) Validate template and prefill params
 * 2) Ask user for new params (schema modal or JSON)
 * 3) Validate/sanitize params
 * 4) Render new HTML and optimistically update dashboard
 * 5) Replace wrapper in file via best-effort locating
 * 6) Persist, refresh and emit events
 */
export async function editTemplateParamsOnDashboard(
	ctx: WrapperDomContext,
	fileCtx: FileContextHint,
	deps: AppDeps
): Promise<void> {
	const { wrapperEl, templateKey, instanceId } = ctx;
	const { filePath, lineHint0 } = fileCtx;
	const { templating, vault, refresh, notices, eventBus } = deps;

	const def = templating.findTemplateById(templateKey);
	if (!def) {
		notices?.warn?.(`Unknown template: ${templateKey}`);
		return;
	}
	if (def.hiddenFromDynamicCommands) return;
	if (!def.hasParams) return;

	const prefill =
		templating.prefillTemplateParams(templateKey, wrapperEl) ??
		({} as TemplateParams);

	let params: TemplateParams | undefined;
	if (def.paramsSchema && def.paramsSchema.fields?.length) {
		// Merge defaults into the schema for nicer UX; For dropdowns, normalize prefill to an option value.
		const schema = {
			...def.paramsSchema,
			fields: def.paramsSchema.fields.map((f: any) => {
				const pre = prefill[f.name];
				let nextDefault = pre != null ? String(pre) : f.defaultValue;

				if (
					String(f.type) === "dropdown" &&
					Array.isArray(f.options) &&
					pre != null
				) {
					const normalized = normalizeDropdownPrefillToOptionValue(
						pre,
						f.options
					);
					if (normalized != null) {
						nextDefault = normalized;
					}
				}

				return {
					...f,
					defaultValue: nextDefault,
				};
			}),
		};
		params = await templating.showSchemaModal(templateKey, schema, true);
	} else {
		const jsonParams = JSON.stringify(prefill ?? {}, null, 2);
		params = await templating.showJsonModal(templateKey, jsonParams);
	}
	if (!params) return; // user cancelled

	// Validate/sanitize params
	const validation = validateAndSanitizeParams(
		params,
		def.paramsSchema as any
	);
	if (!validation.ok) {
		notices?.error?.(
			`Invalid parameters: ${validation.error ?? "Unknown error"}`
		);
		return;
	}
	const cleanParams = validation.value!;

	// Render and preserve instance id
	let newHtml = templating.renderTemplateOnly(templateKey, cleanParams);
	newHtml = preserveInstanceIdInHtml(newHtml, instanceId);

	// Optimistic UI update
	try {
		wrapperEl.outerHTML = newHtml;
	} catch {
		// ignore
	}

	eventBus?.dispatch("agile:prepare-optimistic-file-change", { filePath });

	// Persist change in file content
	let content: string;
	if (typeof vault.fileExists === "function") {
		const exists = await vault.fileExists(filePath);
		if (!exists) {
			throw new Error(`File not found: ${filePath}`);
		}
		content = await vault.readFile(filePath);
	} else {
		try {
			content = await vault.readFile(filePath);
		} catch {
			throw new Error(`File not found: ${filePath}`);
		}
	}

	// Locate in priority: instance id -> near line -> anywhere by key
	let spanRange: [number, number] | null = null;
	if (instanceId) {
		spanRange = locateByInstanceId(content, instanceId);
	}
	if (!spanRange && typeof lineHint0 === "number") {
		spanRange = locateNearLineByKey(content, templateKey, lineHint0);
	}
	if (!spanRange) {
		spanRange = locateFirstByKey(content, templateKey);
	}

	if (!spanRange) {
		throw new Error("Unable to locate template wrapper in file");
	}

	const [start, end] = spanRange;
	const updated = content.slice(0, start) + newHtml + content.slice(end);
	if (updated === content) {
		throw new Error("Template edit produced no changes");
	}

	await vault.writeFile(filePath, updated);

	// Refresh and emit event
	await refresh.refreshForFile(filePath);
	eventBus?.dispatch("agile:task-updated", { filePath });
}
