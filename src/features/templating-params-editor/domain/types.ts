/**
 * Core domain types for the templating params editor.
 */

export interface EventBusLike {
	dispatch<N extends string>(name: N, payload: any): void;
}

export interface ParamField {
	name: string;
	type?: "string" | "number" | "boolean" | "any";
	required?: boolean;
	defaultValue?: string;
}

export interface ParamsSchema {
	fields: ParamField[];
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
