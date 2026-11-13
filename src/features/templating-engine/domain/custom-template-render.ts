/**
 * Custom template rendering (G15) and the definition built from a validated spec.
 *
 * Output goes through `wrapTemplate(id, inner, { orderTag })` so a custom chip has the same
 * shape as a built-in: a wrapper span with `data-template-wrapper`, `data-template-key` and
 * `data-order-tag`, around a `<mark>` made by `markChip`. Values sit in
 * `<span data-tpl-var="name">`. The pattern is walked as parsed data, in a single pass, and
 * every value and literal is HTML-escaped, so a value such as `{{title}}` or `<b>` stays
 * literal text and is never expanded or interpreted.
 */

import { escapeHtml } from "@utils";
import { markChip, wrapTemplate } from "../ui/html-partials";
import { wrapVar } from "./template-parameter-helpers";
import type { ParamsSchemaField, TemplateDefinition } from "./types";
import type { PatternLeaf } from "./custom-template-pattern";
import type { CustomFieldSpec, CustomTemplateSpec } from "./custom-template-schema";

type Params = Record<string, unknown> | undefined;

function valueOf(params: Params, name: string): string {
	if (!params || !Object.prototype.hasOwnProperty.call(params, name)) {
		return "";
	}
	const v = params[name];
	if (typeof v === "string") return v.trim();
	if (typeof v === "number" || typeof v === "boolean") return String(v);
	return "";
}

function renderField(field: CustomFieldSpec, value: string): string {
	if (field.type === "dropdown") {
		// The chip shows the option's label; the value is kept in data-tpl-value (P3)
		// so editing preselects the right option.
		const option = (field.options ?? []).find((o) => o.value === value);
		const shown = option ? option.label : value;
		return `<span data-tpl-var="${escapeHtml(field.name)}" data-tpl-value="${escapeHtml(
			value
		)}">${escapeHtml(shown)}</span>`;
	}
	if (field.type === "textarea") {
		const html = escapeHtml(value).replace(/\r\n|\r|\n/g, "<br>");
		return `<span data-tpl-var="${escapeHtml(field.name)}">${html}</span>`;
	}
	return wrapVar(field.name, value);
}

/** Render the chip HTML (a full wrapper span) for a spec and a set of values. */
export function renderCustomTemplate(
	spec: CustomTemplateSpec,
	params?: Record<string, unknown>
): string {
	const byName = new Map<string, CustomFieldSpec>();
	for (const f of spec.fields) byName.set(f.name, f);

	const leaf = (node: PatternLeaf): string => {
		if (node.kind === "text") return escapeHtml(node.value);
		const field = byName.get(node.name);
		return field ? renderField(field, valueOf(params, node.name)) : "";
	};

	let body = "";
	for (const node of spec.pattern) {
		if (node.kind === "section") {
			if (valueOf(params, node.name) === "") continue;
			body += node.children.map(leaf).join("");
		} else {
			body += leaf(node);
		}
	}

	const text = spec.emoji ? `${escapeHtml(spec.emoji)} ${body}` : body;
	const chip = markChip({
		id: `custom-${spec.id}`,
		text,
		bg: spec.color,
		color: spec.textColor,
	});
	return wrapTemplate(spec.id, chip, { orderTag: spec.orderTag });
}

/** Build the registry definition for a validated spec. No code from the spec is run. */
export function buildCustomTemplateDefinition(
	spec: CustomTemplateSpec
): TemplateDefinition {
	const hasFields = spec.fields.length > 0;
	const fields: ParamsSchemaField[] = spec.fields.map((f) => {
		const out: ParamsSchemaField = {
			name: f.name,
			label: f.label,
			type: f.type,
			required: f.required,
		};
		if (f.placeholder !== undefined) out.placeholder = f.placeholder;
		if (f.defaultValue !== undefined) out.defaultValue = f.defaultValue;
		if (f.description !== undefined) out.description = f.description;
		if (f.options) out.options = f.options.map((o) => ({ ...o }));
		return out;
	});

	return {
		id: spec.id,
		label: spec.label,
		hasParams: hasFields,
		orderTag: spec.orderTag,
		rules: {
			allowedOn: [...spec.allowedOn],
			...(spec.topLevel ? { topLevel: true } : {}),
		},
		paramsSchema: hasFields
			? {
					titles: {
						create: `Create ${spec.label}`,
						edit: `Edit ${spec.label}`,
					},
					fields,
			  }
			: undefined,
		render: (params?: unknown) =>
			renderCustomTemplate(spec, params as Params),
	};
}
