import { App, PluginSettingTab, Setting } from "obsidian";
import AgileObsidian from "./main";

export interface AgileObsidianSettings {
	showObjectives: boolean;
	showTasks: boolean;
	showStories: boolean;
	showEpics: boolean;
	showInitiatives: boolean;
	showResponsibilities: boolean;
	showPriorities: boolean;
}

export const DEFAULT_SETTINGS: AgileObsidianSettings = {
	showObjectives: true,
	showTasks: true,
	showStories: true,
	showEpics: true,
	showInitiatives: true,
	showResponsibilities: true,
	showPriorities: true,
};

export class AgileSettingTab extends PluginSettingTab {
	plugin: AgileObsidian;

	constructor(app: App, plugin: AgileObsidian) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty(); // Clear existing content

		containerEl.createEl("h1", { text: "Agile Obsidian Settings" });

		containerEl.createEl("h3", { text: "Project View" });
		containerEl.createEl("h5", { text: "Toggle Sections" });

		// Description
		new Setting(containerEl)
			.setDesc(
				"Select which sections to display in project view. Note, any section containing no tasks will be hidden by default."
			)
			.setClass("setting-item-description"); // Optional: Makes it look like a plain description

		// Toggles for each section
		new Setting(containerEl)
			.setName("🎯 Objectives (OKRs)")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showObjectives)
					.onChange(async (value) => {
						this.plugin.settings.showObjectives = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("🔨 Tasks (Subtasks)")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showTasks)
					.onChange(async (value) => {
						this.plugin.settings.showTasks = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl).setName("📝 Stories").addToggle((toggle) =>
			toggle
				.setValue(this.plugin.settings.showStories)
				.onChange(async (value) => {
					this.plugin.settings.showStories = value;
					await this.plugin.saveSettings();
				})
		);

		new Setting(containerEl).setName("🏆 Epics").addToggle((toggle) =>
			toggle
				.setValue(this.plugin.settings.showEpics)
				.onChange(async (value) => {
					this.plugin.settings.showEpics = value;
					await this.plugin.saveSettings();
				})
		);

		new Setting(containerEl).setName("🎖️ Initiatives").addToggle((toggle) =>
			toggle
				.setValue(this.plugin.settings.showInitiatives)
				.onChange(async (value) => {
					this.plugin.settings.showInitiatives = value;
					await this.plugin.saveSettings();
				})
		);

		new Setting(containerEl)
			.setName("🧹 Responsibilities")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showResponsibilities)
					.onChange(async (value) => {
						this.plugin.settings.showResponsibilities = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl).setName("📁 Priorities").addToggle((toggle) =>
			toggle
				.setValue(this.plugin.settings.showPriorities)
				.onChange(async (value) => {
					this.plugin.settings.showPriorities = value;
					await this.plugin.saveSettings();
				})
		);
	}
}
