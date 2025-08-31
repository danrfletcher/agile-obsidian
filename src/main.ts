import { Plugin } from "obsidian";

import { createContainer } from "./composition/container";
import type { Container } from "./composition/container";
import { registerStyles } from "./composition/register-styles";
import { AgileObsidianSettings } from "./features/settings/settings.types";
import {
	initSettings,
	registerSettings,
} from "./composition/register-settings";

export default class AgileObsidian extends Plugin {
	settings: AgileObsidianSettings;
	container?: Container;

	async onload() {
		// Load settings via composition helper (feature-agnostic)
		await initSettings(this);

		const container = createContainer(this);
		this.container = container;
		registerStyles(container);

		// Register the settings feature (UI, presenters, actions) via composition
		await registerSettings(container);
	}

	onunload() {}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
