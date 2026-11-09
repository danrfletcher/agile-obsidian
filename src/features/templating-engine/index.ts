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
