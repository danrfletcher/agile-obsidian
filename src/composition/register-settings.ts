import { createDefaultSettings, createSettingsTab } from "@settings";
import type { AgileObsidianSettings } from "@settings";
import type { Plugin, PluginSettingTab } from "obsidian";
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
	const stored = (await plugin.loadData?.()) as
		| Partial<AgileObsidianSettings>
		| null;
	const settings: AgileObsidianSettings = createDefaultSettings(
		stored ?? null
	);
	plugin.settings = settings;
	return settings;
}

/**
 * Registers the plugin settings tab and hooks feature-specific settings sub-systems.
 */
export async function registerSettings(container: Container): Promise<void> {
	const { app, plugin, settings } = container;
	const p = plugin as Plugin & {
		saveSettings?: () => Promise<void>;
		saveData?: (data: AgileObsidianSettings) => Promise<void>;
	};

	const saveSettingsLocal = async (): Promise<void> => {
		if (typeof p.saveSettings === "function") {
			await p.saveSettings();
		} else if (typeof p.saveData === "function") {
			await p.saveData(settings);
		}

		try {
			interface WorkspaceWithTrigger {
				trigger(name: string, ...data: unknown[]): void;
			}
			(app.workspace as unknown as WorkspaceWithTrigger).trigger(
				"agile-settings-changed"
			);
		} catch (e) {
			globalThis.console?.warn?.(
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
		applyCheckboxStyles: () => {
			applyCheckboxStylesSetting(container);
		},
	});

	p.addSettingTab(
		createSettingsTab({
			app,
			plugin: p,
			settings,
			orgActions,
			saveSettings: saveSettingsLocal,
			applyCheckboxStyles: () => checkbox.applyCheckboxStyles(),
		}) as PluginSettingTab
	);
}