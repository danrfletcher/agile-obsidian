import { createSettingsTab, loadStoredSettings } from "@settings";
import type { AgileObsidianSettings } from "@settings";
import type { Plugin, PluginSettingTab } from "obsidian";
import type { Container } from "./container";

/**
 * Initializes settings by loading persisted data (if available) and applying defaults.
 * Only known keys are copied from stored data. If any stored keys were dropped,
 * the cleaned settings are saved once; a second load finds nothing to drop and does not save.
 */
export async function initSettings(
	plugin: Plugin & {
		settings?: AgileObsidianSettings;
		loadData?: () => Promise<unknown>;
		saveData?: (data: AgileObsidianSettings) => Promise<void>;
	}
): Promise<AgileObsidianSettings> {
	const stored: unknown = await plugin.loadData?.();
	const { settings, needsSave } = loadStoredSettings(stored);
	plugin.settings = settings;
	if (needsSave) {
		await plugin.saveData?.(settings);
	}
	return settings;
}

/**
 * Registers the plugin settings tab.
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

	p.addSettingTab(
		createSettingsTab({
			app,
			plugin: p,
			settings,
			saveSettings: saveSettingsLocal,
		}) as PluginSettingTab
	);
}
