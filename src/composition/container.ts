import type { Plugin, App } from "obsidian";
import type { AgileObsidianSettings } from "src/features/settings/settings.types";

export interface Container {
	plugin: Plugin;
	app: App;
	settings: AgileObsidianSettings;
	manifestId: string;
}

export function createContainer(plugin: Plugin & { settings: any }): Container {
	return {
		plugin,
		app: (plugin as any).app,
		settings: (plugin as any).settings,
		manifestId: (plugin as any).manifest?.id ?? "",
	};
}
