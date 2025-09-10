import { Plugin } from "obsidian";
import { createContainer, type Container } from "@composition/container";
import { registerStyles } from "@composition/register-styles";
import { initSettings, registerSettings } from "@composition/register-settings";
import { registerAllCommands } from "@composition/register-commands";
import { registerEvents } from "@composition/register-events";
import { AgileObsidianSettings } from "@settings";

export default class AgileObsidian extends Plugin {
	settings: AgileObsidianSettings;
	container?: Container;

	async onload() {
		// Load settings via composition helper
		await initSettings(this);

		const container = createContainer(this);
		this.container = container;

		registerStyles(container);

		// Register settings via composition
		await registerSettings(container);

		// Register task/vault events (build task index + subscribe to changes)
		await registerEvents(container);

		// Register commands and views for features
		if (container) await registerAllCommands(container);
	}

	onunload() {}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
