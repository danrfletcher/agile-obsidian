/**
 * Public API for the Settings feature.
 * Import from this module root; do not deep-import internal files.
 */
export type { AgileObsidianSettings } from "./domain/settings-types";

// Factories
export {
	createDefaultSettings,
	loadStoredSettings,
	createSettingsTab,
} from "./app/factories";
export type { SettingsTabDeps } from "./app/factories";
export type { LoadedSettings } from "./app/settings-load";

// Orchestration
export { registerSettingsFeature } from "./app/orchestration";
export type { RegisterSettingsDeps } from "./app/orchestration";

// Service
export { createSettingsService, type SettingsService } from "./app/service";
