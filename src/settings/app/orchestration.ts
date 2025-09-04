/**
 * Application orchestration for settings.
 * Avoid importing composition/container. Define factories that accept explicit deps.
 * Composition should call these factories.
 */
import type { App, Plugin } from "obsidian";
import type { AgileObsidianSettings } from "../domain/settings-types";
import { createSettingsTab } from "./factories";
import type { SettingsOrgActions } from "./contracts";

/**
 * Dependencies required to register the Settings feature with Obsidian.
 * - plugin: an Obsidian Plugin instance that supports addSettingTab (standard).
 */
export type RegisterSettingsDeps = {
	app: App;
	plugin: Plugin;
	settings: AgileObsidianSettings;
	orgActions: SettingsOrgActions;
	applyCheckboxStyles: () => Promise<void>;
	saveSettings: () => Promise<void>;
};

/**
 * Registers the Settings tab with Obsidian given explicit dependencies.
 * Side-effect: calls plugin.addSettingTab(tab).
 */
export function registerSettingsFeature(deps: RegisterSettingsDeps) {
	const {
		app,
		plugin,
		settings,
		orgActions,
		applyCheckboxStyles,
		saveSettings,
	} = deps;
	const tab = createSettingsTab({
		app,
		plugin,
		settings,
		orgActions,
		applyCheckboxStyles,
		saveSettings,
	});
	plugin.addSettingTab(tab);
}
