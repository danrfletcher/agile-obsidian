import { Plugin } from "obsidian";
import { createContainer, type Container } from "@composition/container";
import { initSettings, registerSettings } from "@composition/register-settings";
import { registerAllCommands } from "@composition/register-commands";
import { registerEvents } from "@composition/register-events";
import { AgileObsidianSettings } from "@settings";
import { disposeCustomTemplates } from "@features/templating-engine";

export default class AgileObsidian extends Plugin {
	settings: AgileObsidianSettings;
	container?: Container;

	async onload() {
		// Load settings via composition helper
		await initSettings(this);

		const container = createContainer(this);
		this.container = container;

		// Register settings via composition
		await registerSettings(container);

		// Register editor/view events (no vault scan or index at load)
		await registerEvents(container);

		// Register commands and views for features
		if (container) await registerAllCommands(container);
	}

	onunload() {
		// Remove the custom templates from the live registry: their insert commands go with
		// them, and a re-enable starts clean.
		disposeCustomTemplates();
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
