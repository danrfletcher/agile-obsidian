/**
 * Ports define all external interactions for this feature.
 * Provide concrete implementations via your composition module.
 */

import type {
	TemplateDef,
	TemplateParams,
	ParamsSchema,
	EventBusLike,
} from "../domain/types";

export interface TemplatingPorts {
	/**
	 * Lookup a template definition by id (aka templateKey).
	 */
	findTemplateById: (id: string) => TemplateDef | undefined;

	/**
	 * Attempt to prefill parameters from the wrapper element.
	 */
	prefillTemplateParams: (
		templateId: string,
		wrapperEl: HTMLElement
	) => TemplateParams | undefined;

	/**
	 * Render only the template body (wrapper included) with the given params.
	 */
	renderTemplateOnly: (templateId: string, params: TemplateParams) => string;

	/**
	 * Show a schema-driven modal. Return undefined on cancel.
	 */
	showSchemaModal: (
		templateId: string,
		schema: ParamsSchema,
		isEdit: boolean
	) => Promise<TemplateParams | undefined>;

	/**
	 * Show a JSON modal initialized with a JSON string.
	 * Should parse and return a params object, or undefined on cancel.
	 */
	showJsonModal: (
		templateId: string,
		initialJson: string
	) => Promise<TemplateParams | undefined>;
}

export interface VaultPort {
	readFile(path: string): Promise<string>;
	writeFile(path: string, content: string): Promise<void>;
	/**
	 * Optional existence check. If not provided, callers should readFile and handle not-found via throw.
	 */
	fileExists?: (path: string) => Promise<boolean>;
}

export interface RefreshPort {
	refreshForFile: (filePath?: string | null) => Promise<void>;
}

export interface NoticePort {
	info: (msg: string) => void;
	warn: (msg: string) => void;
	error: (msg: string) => void;
}

export interface AppDeps {
	templating: TemplatingPorts;
	vault: VaultPort;
	refresh: RefreshPort;
	notices?: NoticePort;
	eventBus?: EventBusLike;
}
