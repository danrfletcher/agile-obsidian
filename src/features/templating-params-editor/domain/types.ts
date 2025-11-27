/**
 * Core domain types for the templating params editor.
 */

export interface EventBusLike {
	dispatch<N extends string, P = unknown>(name: N, payload: P): void;
}

export type ParamFieldType =
	| "string"
	| "number"
	| "boolean"
	| "any"
	| (string & {});

export interface ParamField {
	name: string;
	label?: string;
	type?: ParamFieldType;
	placeholder?: string;
	defaultValue?: string | number | boolean | null;
	description?: string;
	required?: boolean;
	options?: Array<{ label: string; value: string }>;
}

export interface ParamsSchema {
	title?: string;
	description?: string;
	fields?: ParamField[];
	titles?: { create?: string; edit?: string };
}

export interface TemplateDef {
	id: string;
	hasParams: boolean;
	hiddenFromDynamicCommands?: boolean;
	paramsSchema?: ParamsSchema;
}

export type TemplateParams = Record<string, unknown>;

export interface WrapperDomContext {
	// The span element clicked
	wrapperEl: HTMLElement;
	// The unique instance id (from data-template-wrapper), if present
	instanceId?: string | null;
	// The template key id (from data-template-key)
	templateKey: string;
}

export interface FileContextHint {
	filePath: string;
	lineHint0?: number | null;
}