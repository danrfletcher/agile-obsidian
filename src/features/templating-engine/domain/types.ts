import type { Editor } from "obsidian";

export type AllowedOn = "task" | "list" | "any";

export interface RuleObject {
	allowedOn?: AllowedOn[]; // Where it can be rendered
	topLevel?: boolean; // Must be at top-level (no parents)
	parent?: string[]; // Allowed parent template ids (template IDs)
}

export type Rule = RuleObject | RuleObject[];

/**
 Param input type rendering in the modal
 - text: single-line input (default when omitted)
 - textarea: multi-line input
 - dropdown: select from a predefined list of options
 - blockSelect: free-text input with autosuggest from the vault:
    * matches file names across the vault
    * matches all blocks across the vault (every non-empty line), regardless of whether they have a block ID
    * when a block is selected, ensures it has a block ID (creates/appends one if needed) and returns "<filePath>#^<blockId>"
*/
export type ParamInputType = "text" | "textarea" | "dropdown" | "blockSelect";

// Optional modal titles to distinguish create/edit flows
export type ParamsSchemaTitles = {
	create?: string;
	edit?: string;
};

// Dropdown options: simplified (index signature removed)
export type ParamsSchemaOptions = Array<{
	label: string;
	value: string;
}>;

export type ParamsSchemaField = {
	name: string;
	label?: string;
	type?: ParamInputType; // default is "text" when omitted
	placeholder?: string;
	defaultValue?: string | number | boolean | null;
	description?: string;
	required?: boolean;
	/**
	 For dropdown fields:
	 - Provide an array of options. "label" is the user-facing string, "value" is returned to the template.
	 - If defaultValue is provided and matches an option's value, that option will be preselected.
	*/
	options?: ParamsSchemaOptions;
};

// Params schema used to render input modals; fields are required for clarity downstream
export type ParamsSchema = {
	title?: string;
	description?: string;
	fields: ParamsSchemaField[];
	titles?: ParamsSchemaTitles; // optional create/edit titles
};

// Template definition for a renderable template
export interface TemplateDefinition<TParams = unknown> {
	id: string;
	label?: string;
	hasParams?: boolean;
	paramsSchema?: ParamsSchema;
	defaults?: Partial<TParams>;
	rules?: Rule; // typed rules instead of unknown Record
	// New: each template can declare its orderTag at the definition level
	orderTag?: string;
	// Optional insertion workflows (run before insertion)
	// Each string references a workflow or composed workflow registered in template-workflows.ts
	insertWorkflows?: string[];
	render?: (params?: TParams) => string;
	parseParamsFromDom?: (
		el: HTMLElement
	) => Partial<TParams> | Record<string, string>;
	hiddenFromDynamicCommands?: boolean;
}

export type TemplateCollection = {
	[key: string]: TemplateDefinition<unknown>;
};

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
