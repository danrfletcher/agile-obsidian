import type { Editor } from "obsidian";

export type AllowedOn = "task" | "list" | "any";

export interface RuleObject {
	allowedOn?: AllowedOn[]; // Where it can be rendered
	topLevel?: boolean; // Must be at top-level (no parents)
	parent?: string[]; // Allowed parent template ids
}

export type Rule = RuleObject | RuleObject[];

/**
 Param input type rendering in the modal
 - text: single-line input
 - textarea: multi-line input
*/
export type ParamInputType = "text" | "textarea";

export interface ParamSchemaField {
	name: string; // field name used in render(params)
	label: string; // human-facing label
	description?: string; // helper text shown under the input
	required?: boolean; // default false = optional
	type?: ParamInputType; // default "text"
	placeholder?: string; // input placeholder
	defaultValue?: string; // suggested value (pre-filled)
}

export interface ParamSchema {
	title?: string; // modal title override
	description?: string; // shown at the top of the modal
	fields: ParamSchemaField[]; // ordered list of fields to render
}

export interface TemplateDefinition<TParams = any> {
	id: string;
	label: string;
	description?: string;
	rules?: Rule;

	// If true, we will prompt for parameters before insert unless params are supplied programmaticlly.
	hasParams?: boolean;

	// If present, we use this schema to render a form-based modal instead of raw-JSON.
	paramsSchema?: ParamSchema;

	// Optional: default param values if user omits fields in modal or programmatic calls
	defaults?: Partial<TParams>;

	// Optional: hide this template from dynamic command registration.
	// Useful when you plan to provide custom command factory functions for it later.
	hiddenFromDynamicCommands?: boolean;

	// Optional: Extract params from a rendered DOM wrapper (post-insert editing).
	// If not supplied, a best-effort generic extractor is used (based on paramsSchema).
	parseParamsFromDom?: (
		wrapperEl: HTMLElement
	) => Record<string, unknown> | undefined;

	// Render returns inline HTML (no "- [ ]" / "- " prefix). Wrapping happens in insertTemplateAtCursor and
	// we additionally wrap with a consistent outer span for edit-clicks (see htmlPartials.wrapTemplate).
	render: (params?: TParams) => string;
}

export interface TemplateGroup {
	[key: string]: TemplateDefinition<any>;
}

export interface PresetTemplates {
	[group: string]: TemplateGroup | { [subgroup: string]: TemplateGroup };
}

export interface TemplateContext {
	line: string;
	file: unknown; // string | string[] | custom document payload
	path: string; // file path
	editor?: Editor; // Obsidian Editor (recommended)
}

export interface TemplateInsertErrorDetails {
	code:
		| "NOT_ALLOWED_HERE"
		| "TOP_LEVEL_ONLY"
		| "PARENT_MISSING"
		| "UNKNOWN_TEMPLATE"
		| "RENDER_FAILED";
	messages?: string[];
	foundAncestors?: string[];
	requiredParents?: string[];
}

export class TemplateInsertError extends Error {
	details: TemplateInsertErrorDetails;
	constructor(message: string, details: TemplateInsertErrorDetails) {
		super(message);
		this.name = "TemplateInsertError";
		this.details = details;
	}
}
