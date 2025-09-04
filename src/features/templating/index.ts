export type { TaskIndexPort } from "./app/templating-ports";

export { wireTemplatingDomHandlers } from "./app/templating-event-manager";

export { insertTemplateAtCursor } from "./app/templating-service";

export { getTemplateKeysFromTask } from "./domain/templates-in-tasks";

export { registerTemplatingDynamicCommands } from "./app/dynamic-commands";
