/**
 * Application-level factories for the Settings feature.
 * Expose stable APIs that composition can call to construct UI and settings instances.
 */
import { DEFAULT_SETTINGS } from "../infra/settings-store";
import { AgileSettingTab } from "../ui/views/settings-view";
import type { AgileObsidianSettings } from "../domain/settings.types";
import type { App, Plugin } from "obsidian";
import type { SettingsOrgActions } from "./contracts";

/**
 * Merge stored partial settings over defaults to produce a complete settings object.
 * Does not mutate inputs.
 */
export function createDefaultSettings(
	stored?: Partial<AgileObsidianSettings> | null
): AgileObsidianSettings {
	return Object.assign({}, DEFAULT_SETTINGS, stored ?? {});
}

/**
 * Dependencies needed to construct the settings tab.
 * - orgActions implements the team/org operations port.
 * - applyCheckboxStyles allows styling toggles to be re-applied after changes.
 * - saveSettings persists settings mutations.
 */
export type SettingsTabDeps = {
	app: App;
	plugin: Plugin;
	settings: AgileObsidianSettings;
	orgActions: SettingsOrgActions;
	applyCheckboxStyles: () => Promise<void> | void;
	saveSettings: () => Promise<void> | void;
};

/**
 * Factory that constructs the Obsidian settings tab for Agile Obsidian.
 * Keeps the concrete class private to the Settings feature implementation details.
 */
export function createSettingsTab(deps: SettingsTabDeps) {
	const {
		app,
		plugin,
		settings,
		orgActions,
		applyCheckboxStyles,
		saveSettings,
	} = deps;
	return new AgileSettingTab(
		app,
		plugin,
		settings,
		orgActions,
		async () => {
			await saveSettings();
		},
		async () => {
			await applyCheckboxStyles();
		}
	);
}
