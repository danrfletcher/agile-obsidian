import { createDefaultSettings, createSettingsTab } from "@settings";
import type { AgileObsidianSettings } from "@settings";
import type { Plugin } from "obsidian";
import type { Container } from "./container";
import { registerOrgStructureSettings } from "@features/org-structure";
import { registerCustomCheckboxesSettings } from "@styles/custom-checkboxes";
import { applyCheckboxStylesSetting } from "./register-styles";

/**
 * Initializes settings by loading persisted data (if available) and applying defaults.
 */
export async function initSettings(
	plugin: Plugin & {
		settings?: AgileObsidianSettings;
		loadData?: () => Promise<Partial<AgileObsidianSettings> | null>;
		saveData?: (data: AgileObsidianSettings) => Promise<void>;
		saveSettings?: () => Promise<void>;
	}
): Promise<AgileObsidianSettings> {
	const stored = await plugin.loadData?.();
	const settings: AgileObsidianSettings = createDefaultSettings(
		stored ?? null
	);
	plugin.settings = settings;
	return settings;
}

/**
 * Registers the plugin settings tab and hooks feature-specific settings sub-systems.
 */
export async function registerSettings(container: Container) {
	const { app, plugin, settings } = container;
	const p = plugin as Plugin & {
		saveSettings?: () => Promise<void>;
		saveData?: (data: AgileObsidianSettings) => Promise<void>;
		addSettingTab: (tab: any) => void;
	};

	const saveSettingsLocal = async (): Promise<void> => {
		if (typeof p.saveSettings === "function") await p.saveSettings();
		else if (typeof p.saveData === "function") await p.saveData(settings);

		try {
			// @ts-ignore - Obsidian Workspace supports custom events via trigger
			app.workspace.trigger("agile-settings-changed");
		} catch (e) {
			console.warn(
				"[settings] Failed to trigger agile-settings-changed",
				e
			);
		}
	};

	const orgActions = registerOrgStructureSettings({
		app,
		plugin,
		settings,
		saveSettings: saveSettingsLocal,
	});

	const checkbox = registerCustomCheckboxesSettings({
		app,
		plugin,
		settings,
		applyCheckboxStyles: async () =>
			await applyCheckboxStylesSetting(container),
	});

	p.addSettingTab(
		createSettingsTab({
			app,
			plugin: p,
			settings,
			orgActions,
			saveSettings: saveSettingsLocal,
			applyCheckboxStyles: async () =>
				await checkbox.applyCheckboxStyles(),
		}) as any
	);
}
