/**
 * Public API for the Settings feature.
 * Import from this module root; do not deep-import internal files.
 */
export type {
	AgileObsidianSettings,
	TeamInfo,
	MemberInfo,
} from "./domain/settings.types";

// Factories
export { createDefaultSettings, createSettingsTab } from "./app/factories";
export type { SettingsTabDeps } from "./app/factories";

// Orchestration
export { registerSettingsFeature } from "./app/orchestration";
export type { RegisterSettingsDeps } from "./app/orchestration";

// App contracts (ports)
export type { SettingsOrgActions } from "./app/contracts";
