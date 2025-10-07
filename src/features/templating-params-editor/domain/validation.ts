/**
 * Lightweight schema-based validation/sanitization for template params.
 * We intentionally keep this simple: ensure required fields exist, coerce basic types,
 * strip unknown fields if a schema is provided.
 */

import type { ParamField, ParamsSchema, TemplateParams } from "./types";

function coerce(value: unknown, type: ParamField["type"]): unknown {
	switch (type) {
		case "number": {
			const n = typeof value === "number" ? value : Number(value);
			return Number.isFinite(n) ? n : undefined;
		}
		case "boolean": {
			if (typeof value === "boolean") return value;
			if (typeof value === "string") {
				const v = value.trim().toLowerCase();
				if (v === "true") return true;
				if (v === "false") return false;
			}
			return undefined;
		}
		case "string": {
			if (value == null) return "";
			return String(value);
		}
		case "any":
		default:
			return value;
	}
}

export interface ValidationResult {
	ok: boolean;
	value?: TemplateParams;
	error?: string;
}

/**
 * Validate and sanitize params against the provided schema (if present).
 * - Unknown fields are removed when a schema exists.
 * - Required fields without a value are filled from defaultValue (if available) or flagged as error.
 * - Basic type coercion is applied.
 */
export function validateAndSanitizeParams(
	raw: TemplateParams,
	schema?: ParamsSchema
): ValidationResult {
	if (!schema || !schema.fields || schema.fields.length === 0) {
		// No schema: accept as-is
		return { ok: true, value: raw };
	}

	const fieldsByName = new Map<string, ParamField>();
	for (const f of schema.fields) fieldsByName.set(f.name, f);

	const sanitized: TemplateParams = {};
	for (const field of schema.fields) {
		const inputVal = raw[field.name];
		let val = inputVal;

		if (val == null || (typeof val === "string" && val.trim() === "")) {
			if (field.defaultValue != null) {
				val = field.defaultValue;
			} else if (field.required) {
				return {
					ok: false,
					error: `Missing required field: ${field.name}`,
				};
			} else {
				val = undefined;
			}
		}

		const coerced = coerce(val, field.type ?? "any");
		if (field.required && coerced === undefined) {
			return {
				ok: false,
				error: `Invalid value for required field: ${field.name}`,
			};
		}
		if (coerced !== undefined) {
			sanitized[field.name] = coerced;
		}
	}

	// Unknown keys are dropped
	return { ok: true, value: sanitized };
}
