import type { Editor } from "obsidian";

export type AllowedOn = "task" | "list" | "any";

export interface RuleObject {
	allowedOn?: AllowedOn[]; // Where it can be rendered
	topLevel?: boolean; // Must be at top-level (no parents) (we won’t set this per your request)
	parent?: string[]; // Allowed parent template ids
}

export type Rule = RuleObject | RuleObject[];

export interface TemplateDefinition<TParams = any> {
	id: string;
	label: string;
	description?: string;
	rules?: Rule;
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
