/**
 * Barrel export for the templating-params-editor feature.
 * This module is wiring-agnostic. Provide concrete ports via your composition module.
 */

export type { EventBusLike, TemplateParams, TemplateDef } from "./domain/types";
export type {
	TemplatingPorts,
	VaultPort,
	RefreshPort,
	NoticePort,
} from "./app/ports";

export { attachDashboardTemplatingHandler } from "./ui/handlers/dashboard-click-handler";

// New: editor handler for regular notes (Markdown editor/live preview)
export { attachEditorTemplatingHandler } from "./ui/handlers/editor-click-handler";

// Unified parameter collection for create/edit flows
export type { ParamsTemplatingPorts } from "./app/request-template-params";
export { requestTemplateParams } from "./app/request-template-params";

export { showSchemaModal } from "./ui/modals/template-schema-modal";
export { showJsonModal } from "./ui/modals/template-json-modal";
