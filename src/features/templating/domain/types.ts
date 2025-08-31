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

// Add optional titles (create/edit) to params schema to support different modal titles
export type ParamsSchemaTitles = {
	create?: string;
	edit?: string;
};

export type ParamsSchemaField = {
	name: string;
	label?: string;
	type?: string;
	placeholder?: string;
	defaultValue?: string | number | boolean | null;
	description?: string;
	required?: boolean;
	options?: Array<{ label: string; value: string }>;
};

// Extend ParamsSchema to optionally include titles. 'fields' is required to simplify downstream code.
export type ParamsSchema = {
	title?: string;
	description?: string;
	fields: ParamsSchemaField[];
	// optional object with create/edit variants
	titles?: ParamsSchemaTitles;
};

// Update TemplateDefinition to use ParamsSchema and include optional defaults and hidden flag used elsewhere
export interface TemplateDefinition<TParams = unknown> {
	id: string;
	label?: string;
	hasParams?: boolean;
	paramsSchema?: ParamsSchema;
	defaults?: Partial<TParams>;
	rules?: Record<string, unknown>;
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
