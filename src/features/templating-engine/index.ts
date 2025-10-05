export type { TaskIndexPort } from "./app/templating-ports";
export type { ParamsSchema, ParamsSchemaField } from "./domain/types";

export { wireTemplatingDomHandlers } from "./app/templating-event-manager";

export {
	insertTemplateAtCursor,
	renderTemplateOnly,
} from "./app/templating-service";

export { getTemplateKeysFromTask } from "./domain/templates-in-tasks";

export { registerTemplatingDynamicCommands } from "./app/dynamic-commands";
