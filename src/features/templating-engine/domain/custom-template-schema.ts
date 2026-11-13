/**
 * Custom template schema (G13) and validator.
 *
 * `validateCustomTemplateText(text, otherIds)` turns the raw JSON text of one settings card
 * into either a normalised `CustomTemplateSpec` or a list of errors. It is pure: it never
 * executes anything from the text, and it never reads the registry (the caller passes the ids
 * that are already taken: built-in ids and the ids of earlier loaded custom templates).
 *
 * Every error carries the path of the offending key (`fields[1].name`). A JSON syntax error
 * has no path and carries the `JSON.parse` message verbatim.
 */

import tokensData from "./tokens.json";
import type { AllowedOn } from "./types";
import { isCssColor } from "./css-color";
import {
	FIELD_NAME_RE,
	parsePattern,
	type PatternNode,
} from "./custom-template-pattern";

export type CustomFieldType = "text" | "textarea" | "dropdown";
export type CustomOrderTag =
	| "artifact-item-type"
	| "parent-link"
	| "state"
	| "metadata";

export interface CustomFieldOption {
	label: string;
	value: string;
}

export interface CustomFieldSpec {
	name: string;
	/** Defaults to the name capitalised. */
	label: string;
	type: CustomFieldType;
	required: boolean;
	placeholder?: string;
	defaultValue?: string;
	description?: string;
	/** Dropdown only. A plain-string option has the same text as label and value. */
	options?: CustomFieldOption[];
}

export interface CustomTemplateSpec {
	id: string;
	label: string;
	/** "" when none. */
	emoji: string;
	/** Defaults to `colors.artifactGrey` from tokens.json. */
	color: string;
	textColor?: string;
	allowedOn: AllowedOn[];
	topLevel: boolean;
	orderTag: CustomOrderTag;
	fields: CustomFieldSpec[];
	/** The pattern text as written. */
	text: string;
	/** The pattern as parsed by the tokenizer. */
	pattern: PatternNode[];
}

export interface CustomTemplateError {
	/** e.g. `fields[1].name`; "" for a JSON syntax error. */
	path: string;
	message: string;
}

export interface CustomTemplateValidation {
	ok: boolean;
	errors: CustomTemplateError[];
	/** `errors` as display strings: "path: message", or the bare message when there is no path. */
	messages: string[];
	/** Present only when `ok`. */
	spec: CustomTemplateSpec | null;
}

export const ORDER_TAGS: readonly CustomOrderTag[] = [
	"artifact-item-type",
	"parent-link",
	"state",
	"metadata",
];
const FIELD_TYPES: readonly CustomFieldType[] = ["text", "textarea", "dropdown"];
const ALLOWED_ON: readonly AllowedOn[] = ["task", "list", "any"];

const TEMPLATE_KEYS = new Set([
	"id",
	"label",
	"emoji",
	"color",
	"textColor",
	"allowedOn",
	"topLevel",
	"orderTag",
	"fields",
	"text",
]);
const FIELD_KEYS = new Set([
	"name",
	"label",
	"type",
	"required",
	"placeholder",
	"defaultValue",
	"description",
	"options",
]);
const OPTION_KEYS = new Set(["label", "value"]);

const ID_PREFIX = "custom.";
const ID_CHARS_RE = /^[a-z0-9.-]+$/;

export const DEFAULT_CUSTOM_COLOR: string = (
	tokensData.colors as Record<string, string>
).artifactGrey;

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** "timebox" -> "Timebox". */
export function capitalise(name: string): string {
	return name.length > 0 ? name.charAt(0).toUpperCase() + name.slice(1) : name;
}

export function formatCustomTemplateError(e: CustomTemplateError): string {
	return e.path ? `${e.path}: ${e.message}` : e.message;
}

function result(
	errors: CustomTemplateError[],
	spec: CustomTemplateSpec | null
): CustomTemplateValidation {
	const ok = errors.length === 0 && spec !== null;
	return {
		ok,
		errors,
		messages: errors.map(formatCustomTemplateError),
		spec: ok ? spec : null,
	};
}

export function validateCustomTemplateText(
	text: string,
	otherIds: readonly string[] = []
): CustomTemplateValidation {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		return result([{ path: "", message }], null);
	}
	return validateCustomTemplate(parsed, otherIds);
}

export function validateCustomTemplate(
	raw: unknown,
	otherIds: readonly string[] = []
): CustomTemplateValidation {
	const errors: CustomTemplateError[] = [];
	const err = (path: string, message: string) =>
		errors.push({ path, message });

	if (!isRecord(raw)) {
		err("template", "must be a JSON object");
		return result(errors, null);
	}

	for (const key of Object.keys(raw)) {
		if (!TEMPLATE_KEYS.has(key)) err(key, "unknown key");
	}

	// id
	let id = "";
	if (raw.id === undefined || raw.id === "") {
		err("id", "required");
	} else if (typeof raw.id !== "string") {
		err("id", "must be a string");
	} else {
		id = raw.id;
		if (!id.startsWith(ID_PREFIX)) {
			err("id", `must start with "${ID_PREFIX}"`);
		} else if (id.length === ID_PREFIX.length) {
			err("id", `needs a name after "${ID_PREFIX}"`);
		} else if (!ID_CHARS_RE.test(id)) {
			err("id", "may only contain a-z, 0-9, . and -");
		} else if (otherIds.indexOf(id) !== -1) {
			err("id", `"${id}" is already used by another template`);
		}
	}

	// label
	let label = "";
	if (raw.label === undefined) {
		err("label", "required");
	} else if (typeof raw.label !== "string") {
		err("label", "must be a string");
	} else if (raw.label.trim() === "") {
		err("label", "required");
	} else {
		label = raw.label.trim();
	}

	// emoji
	let emoji = "";
	if (raw.emoji !== undefined) {
		if (typeof raw.emoji !== "string") err("emoji", "must be a string");
		else emoji = raw.emoji.trim();
	}

	// colours
	let color = DEFAULT_CUSTOM_COLOR;
	if (raw.color !== undefined) {
		if (typeof raw.color !== "string") {
			err("color", "must be a string");
		} else if (!isCssColor(raw.color)) {
			err(
				"color",
				"must be a CSS colour (hex, rgb(), rgba(), hsl(), hsla() or a colour name)"
			);
		} else {
			color = raw.color.trim();
		}
	}
	let textColor: string | undefined;
	if (raw.textColor !== undefined) {
		if (typeof raw.textColor !== "string") {
			err("textColor", "must be a string");
		} else if (!isCssColor(raw.textColor)) {
			err(
				"textColor",
				"must be a CSS colour (hex, rgb(), rgba(), hsl(), hsla() or a colour name)"
			);
		} else {
			textColor = raw.textColor.trim();
		}
	}

	// allowedOn: a string or an array of strings, normalised to an array
	let allowedOn: AllowedOn[] = ["any"];
	if (raw.allowedOn !== undefined) {
		const list: unknown[] = Array.isArray(raw.allowedOn)
			? raw.allowedOn
			: [raw.allowedOn];
		const picked: AllowedOn[] = [];
		let bad = false;
		list.forEach((v, i) => {
			if (
				typeof v === "string" &&
				(ALLOWED_ON as readonly string[]).indexOf(v) !== -1
			) {
				if (picked.indexOf(v as AllowedOn) === -1) {
					picked.push(v as AllowedOn);
				}
				return;
			}
			bad = true;
			err(
				Array.isArray(raw.allowedOn) ? `allowedOn[${i}]` : "allowedOn",
				"must be task, list or any"
			);
		});
		if (!bad && picked.length === 0) {
			err("allowedOn", "must not be empty");
		} else if (!bad) {
			allowedOn = picked;
		}
	}

	// topLevel
	let topLevel = false;
	if (raw.topLevel !== undefined) {
		if (typeof raw.topLevel !== "boolean") {
			err("topLevel", "must be true or false");
		} else {
			topLevel = raw.topLevel;
		}
	}

	// orderTag
	let orderTag: CustomOrderTag = "metadata";
	if (raw.orderTag !== undefined) {
		if (
			typeof raw.orderTag !== "string" ||
			(ORDER_TAGS as readonly string[]).indexOf(raw.orderTag) === -1
		) {
			err(
				"orderTag",
				"must be artifact-item-type, parent-link, state or metadata"
			);
		} else {
			orderTag = raw.orderTag as CustomOrderTag;
		}
	}

	// fields
	const fields: CustomFieldSpec[] = [];
	const fieldIndexes: number[] = [];
	// Every name that is declared with a usable name, even if the rest of that field is
	// invalid, so the pattern check does not pile "no matching field" on top of it.
	const declared = new Set<string>();
	if (raw.fields !== undefined) {
		if (!Array.isArray(raw.fields)) {
			err("fields", "must be an array");
		} else {
			raw.fields.forEach((f: unknown, i: number) => {
				if (
					isRecord(f) &&
					typeof f.name === "string" &&
					FIELD_NAME_RE.test(f.name)
				) {
					declared.add(f.name);
				}
				const spec = validateField(f, i, fields, err);
				if (spec) {
					fields.push(spec);
					fieldIndexes.push(i);
				}
			});
		}
	}

	// text (pattern)
	let pattern: PatternNode[] = [];
	let text = "";
	if (raw.text === undefined || raw.text === "") {
		err("text", "required");
	} else if (typeof raw.text !== "string") {
		err("text", "must be a string");
	} else {
		text = raw.text;
		const parsed = parsePattern(text, declared);
		for (const m of parsed.errors) err("text", m);
		pattern = parsed.nodes;
		// A declared field that is never used is an error.
		fields.forEach((f, k) => {
			if (!parsed.used.has(f.name)) {
				err(
					`fields[${fieldIndexes[k]}].name`,
					`"${f.name}" is never used in text`
				);
			}
		});
	}

	if (errors.length > 0) return result(errors, null);

	return result([], {
		id,
		label,
		emoji,
		color,
		textColor,
		allowedOn,
		topLevel,
		orderTag,
		fields,
		text,
		pattern,
	});
}

function validateField(
	raw: unknown,
	index: number,
	previous: readonly CustomFieldSpec[],
	err: (path: string, message: string) => void
): CustomFieldSpec | null {
	const at = `fields[${index}]`;
	if (!isRecord(raw)) {
		err(at, "must be an object");
		return null;
	}
	let ok = true;
	const bad = (key: string, message: string) => {
		ok = false;
		err(`${at}.${key}`, message);
	};

	for (const key of Object.keys(raw)) {
		if (!FIELD_KEYS.has(key)) bad(key, "unknown key");
	}

	// name
	let name = "";
	if (raw.name === undefined || raw.name === "") {
		bad("name", "required");
	} else if (typeof raw.name !== "string") {
		bad("name", "must be a string");
	} else if (!FIELD_NAME_RE.test(raw.name)) {
		bad(
			"name",
			"must start with a letter and contain only letters, digits, _ and -"
		);
	} else if (previous.some((p) => p.name === raw.name)) {
		bad("name", `"${raw.name}" is declared twice`);
	} else {
		name = raw.name;
	}

	// type
	let type: CustomFieldType = "text";
	if (raw.type !== undefined) {
		if (
			typeof raw.type !== "string" ||
			(FIELD_TYPES as readonly string[]).indexOf(raw.type) === -1
		) {
			bad("type", "must be text, textarea or dropdown");
		} else {
			type = raw.type as CustomFieldType;
		}
	}

	// label
	let label = capitalise(name);
	if (raw.label !== undefined) {
		if (typeof raw.label !== "string") bad("label", "must be a string");
		else if (raw.label.trim() !== "") label = raw.label.trim();
	}

	// required
	let required = false;
	if (raw.required !== undefined) {
		if (typeof raw.required !== "boolean") {
			bad("required", "must be true or false");
		} else {
			required = raw.required;
		}
	}

	// plain strings
	const strings: Partial<
		Record<"placeholder" | "defaultValue" | "description", string>
	> = {};
	for (const key of ["placeholder", "defaultValue", "description"] as const) {
		const v = raw[key];
		if (v === undefined) continue;
		if (typeof v !== "string") bad(key, "must be a string");
		else strings[key] = v;
	}

	// options (dropdown only; a plain string is both label and value)
	let options: CustomFieldOption[] | undefined;
	if (raw.options !== undefined) {
		if (raw.type !== "dropdown") {
			bad("options", "only allowed when type is dropdown");
		} else if (!Array.isArray(raw.options)) {
			bad("options", "must be an array");
		} else if (raw.options.length === 0) {
			bad("options", "must have at least one option");
		} else {
			const list: CustomFieldOption[] = [];
			raw.options.forEach((o: unknown, j: number) => {
				const opath = `options[${j}]`;
				if (typeof o === "string") {
					if (o === "") bad(opath, "must not be empty");
					else list.push({ label: o, value: o });
					return;
				}
				if (!isRecord(o)) {
					bad(opath, "must be a string or { label, value }");
					return;
				}
				let optOk = true;
				for (const key of Object.keys(o)) {
					if (!OPTION_KEYS.has(key)) {
						bad(`${opath}.${key}`, "unknown key");
						optOk = false;
					}
				}
				for (const key of ["label", "value"] as const) {
					const v = o[key];
					if (typeof v !== "string" || v === "") {
						bad(`${opath}.${key}`, "required");
						optOk = false;
					}
				}
				if (optOk) {
					list.push({
						label: o.label as string,
						value: o.value as string,
					});
				}
			});
			const seen = new Set<string>();
			list.forEach((o) => {
				if (seen.has(o.value)) {
					bad("options", `value "${o.value}" is used twice`);
				}
				seen.add(o.value);
			});
			options = list;
		}
	} else if (raw.type === "dropdown") {
		bad("options", "required for a dropdown");
	}

	if (
		type === "dropdown" &&
		options &&
		strings.defaultValue !== undefined &&
		!options.some((o) => o.value === strings.defaultValue)
	) {
		bad("defaultValue", "must be one of the options");
	}

	if (!ok) return null;
	const spec: CustomFieldSpec = { name, label, type, required };
	if (strings.placeholder !== undefined) spec.placeholder = strings.placeholder;
	if (strings.defaultValue !== undefined) spec.defaultValue = strings.defaultValue;
	if (strings.description !== undefined) spec.description = strings.description;
	if (options) spec.options = options;
	return spec;
}
