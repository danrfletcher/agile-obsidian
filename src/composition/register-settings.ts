import type { Plugin } from "obsidian";
import { DEFAULT_SETTINGS } from "../features/settings/infra/settings-store";
import type { AgileObsidianSettings } from "../features/settings/settings.types";
import type { Container } from "./container";
import { AgileSettingTab } from "../features/settings/ui/settings.ui";
import { registerOrgStructureSettings } from "../features/org-structure/app/org-structure-settings-orchestration";
import { registerCustomCheckboxesSettings } from "../features/custom-checkboxes/checkboxes-settings-orchestration";

export async function initSettings(
	plugin: Plugin & {
		settings?: AgileObsidianSettings;
		loadData?: () => Promise<Partial<AgileObsidianSettings> | null>;
		saveData?: (data: AgileObsidianSettings) => Promise<void>;
		saveSettings?: () => Promise<void>;
	}
): Promise<AgileObsidianSettings> {
	const stored = await plugin.loadData?.();
	const settings: AgileObsidianSettings = Object.assign(
		{},
		DEFAULT_SETTINGS,
		stored ?? {}
	);
	plugin.settings = settings;
	return settings;
}

export async function registerSettings(container: Container) {
	const { app, plugin, settings } = container;
	const p = plugin as Plugin & {
		saveSettings?: () => Promise<void>;
		saveData?: (data: AgileObsidianSettings) => Promise<void>;
	};

	// Feature-specific action factories
	const orgActions = registerOrgStructureSettings(container);
	const checkbox = registerCustomCheckboxesSettings(container);

	async function saveSettings(): Promise<void> {
		if (typeof p.saveSettings === "function") await p.saveSettings();
		else if (typeof p.saveData === "function") await p.saveData(settings);
	}

	// Register the tab, wiring in actions and apply callback
	p.addSettingTab(
		new AgileSettingTab(
			app,
			p,
			settings,
			orgActions,
			() => saveSettings(),
			async () => await checkbox.applyCheckboxStyles()
		)
	);
}
