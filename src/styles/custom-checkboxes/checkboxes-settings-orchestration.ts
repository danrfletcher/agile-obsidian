import type { App, Plugin } from "obsidian";
import type { AgileObsidianSettings } from "@settings";

export function registerCustomCheckboxesSettings(ports: {
	app: App;
	plugin: Plugin;
	settings: AgileObsidianSettings;
	applyCheckboxStyles?: () => Promise<void> | void;
}) {
	return {
		applyCheckboxStyles: async (): Promise<void> => {
			if (typeof ports.applyCheckboxStyles === "function")
				await ports.applyCheckboxStyles();
		},
	};
}
