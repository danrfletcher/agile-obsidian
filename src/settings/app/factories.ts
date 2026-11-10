/**
 * Application-level factories for the Settings feature.
 * Expose stable APIs that composition can call to construct UI and settings instances.
 */
import { AgileSettingTab } from "../ui/views/settings-view";
import type { AgileObsidianSettings } from "../domain/settings-types";
import type { App, Plugin } from "obsidian";
import { loadSettings } from "./settings-load";
import type { LoadedSettings } from "./settings-load";
import type { CardValidation } from "./custom-templates-settings";

/**
 * Produce a complete settings object from stored data, copying only known keys.
 * Does not mutate inputs.
 */
export function createDefaultSettings(
	stored?: unknown
): AgileObsidianSettings {
	return loadSettings(stored).settings;
}

/**
 * Like createDefaultSettings, but also reports whether stored data carried
 * dropped keys (so callers can persist the cleaned object once).
 */
export function loadStoredSettings(stored?: unknown): LoadedSettings {
	return loadSettings(stored);
}

/**
 * Dependencies needed to construct the settings tab.
 * - saveSettings persists settings mutations.
 */
export type SettingsTabDeps = {
	app: App;
	plugin: Plugin;
	settings: AgileObsidianSettings;
	saveSettings: () => Promise<void> | void;
	/** Validate card `index` of the saved custom template texts (the template engine's validator). */
	validateCustomTemplate: (
		texts: readonly string[],
		index: number
	) => CardValidation;
	/** Rebuild the live template registry, commands and sequences from the saved cards. */
	rebuildCustomTemplates: () => void;
};

/**
 * Factory that constructs the Obsidian settings tab for Agile Templates.
 * Keeps the concrete class private to the Settings feature implementation details.
 */
export function createSettingsTab(deps: SettingsTabDeps) {
	const { app, plugin, settings, saveSettings } = deps;
	return new AgileSettingTab(
		app,
		plugin,
		settings,
		async () => {
			await saveSettings();
		},
		{
			validate: deps.validateCustomTemplate,
			rebuild: deps.rebuildCustomTemplates,
		}
	);
}
