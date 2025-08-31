import type { Container } from "src/composition/container";
import { AgileSettingTab } from "../ui/settings.ui";
import { registerOrgStructureSettings } from "src/features/org-structure/app/org-structure-settings-orchestration";
import { registerCustomCheckboxesSettings } from "src/features/custom-checkboxes/checkboxes-settings-orchestration";

export async function registerSettingsFeature(container: Container) {
	const { app, plugin, settings } = container as any;

	const orgActions = registerOrgStructureSettings(container);
	const checkbox = registerCustomCheckboxesSettings(container);

	plugin.addSettingTab(
		new AgileSettingTab(
			app,
			plugin,
			settings,
			orgActions,
			() => saveSettings(),
			async () => await checkbox.applyCheckboxStyles()
		)
	);

	async function saveSettings() {
		if (typeof (plugin as any).saveSettings === "function")
			await (plugin as any).saveSettings();
		else if (typeof (plugin as any).saveData === "function")
			await (plugin as any).saveData(settings);
	}
}
