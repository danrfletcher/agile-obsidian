/**
 * Application orchestration for settings.
 * Avoid importing composition/container. Define factories that accept explicit deps.
 * Composition should call these factories.
 */
import type { App, Plugin } from "obsidian";
import type { AgileObsidianSettings } from "../domain/settings-types";
import { createSettingsTab, type SettingsTabDeps } from "./factories";

/**
 * Dependencies required to register the Settings feature with Obsidian.
 * - plugin: an Obsidian Plugin instance that supports addSettingTab (standard).
 */
export type RegisterSettingsDeps = {
	app: App;
	plugin: Plugin;
	settings: AgileObsidianSettings;
	saveSettings: () => Promise<void>;
} & Pick<SettingsTabDeps, "validateCustomTemplate" | "rebuildCustomTemplates">;

/**
 * Registers the Settings tab with Obsidian given explicit dependencies.
 * Side-effect: calls plugin.addSettingTab(tab).
 */
export function registerSettingsFeature(deps: RegisterSettingsDeps) {
	const tab = createSettingsTab(deps);
	deps.plugin.addSettingTab(tab);
}
