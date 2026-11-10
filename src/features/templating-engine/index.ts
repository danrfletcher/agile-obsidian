export type { ParamsSchema, ParamsSchemaField } from "./domain/types";

export { wireTemplatingDomHandlers } from "./app/templating-event-manager";

export {
	insertTemplateAtCursor,
	renderTemplateOnly,
	findTemplateById,
} from "./app/templating-service";

export { getTemplateKeysFromTask } from "./domain/templates-in-tasks";

export { registerTemplatingDynamicCommands } from "./app/dynamic-commands";

export {
	setDefaultTemplatesEnabled,
	setCustomDefinitions,
	listActiveTemplates,
	findActiveTemplate,
	onTemplateRegistryChange,
} from "./app/template-registry";


// Custom templates (JSON definitions from settings)
export {
	reloadCustomTemplates,
	setCustomTemplateSource,
	disposeCustomTemplates,
	getOtherTemplateIdsForCard,
	validateCustomTemplateCard,
	loadCustomTemplates,
} from "./app/custom-templates";
export type {
	CustomTemplatesLoad,
	CustomTemplateCardResult,
} from "./app/custom-templates";
export {
	validateCustomTemplateText,
	formatCustomTemplateError,
} from "./domain/custom-template-schema";
export type {
	CustomTemplateValidation,
	CustomTemplateError,
	CustomTemplateSpec,
} from "./domain/custom-template-schema";
