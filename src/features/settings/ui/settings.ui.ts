import { App, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import type { AgileObsidianSettings } from "src/app/config/settings.types";
import { TeamsPresenter, TeamsActions } from "./presenters/teams-presenter";
import { IdentityPresenter } from "./presenters/identity-presenter";
import { AddTeamModal } from "./modals/add-team-modal";

export class AgileSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: Plugin,
		private settings: AgileObsidianSettings,
		private actions: TeamsActions,
		private saveSettings: () => Promise<void>,
		private applyCheckboxStylesSetting: () => Promise<void>
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h1", { text: "Agile Obsidian Settings" });

		// Teams section
		containerEl.createEl("h3", { text: "Teams" });
		const teamsButtons = new Setting(containerEl)
			.setName("List Members & Teams")
			.setDesc(
				"Detects teams and organizations from your vault and adds new teams."
			);

		teamsButtons.addButton((btn) =>
			btn
				.setButtonText("Update Teams")
				.setCta()
				.onClick(async () => {
					await this.actions.detectAndUpdateTeams();
					this.display(); // refresh whole UI
					new Notice(`Detected ${this.getTeamsCount()} team(s).`);
				})
		);

		teamsButtons.addButton((btn) =>
			btn.setButtonText("Add Team").onClick(() => {
				new AddTeamModal(
					this.app,
					this.settings.teamsFolder || "Teams",
					async (teamName, parentPath, teamSlug, code) => {
						await this.actions.createTeam(
							teamName,
							parentPath,
							teamSlug,
							code
						);
						await this.actions.detectAndUpdateTeams();
						this.display();
						new Notice(`Team "${teamName}" added.`);
					}
				).open();
			})
		);

		const teamsListContainer = containerEl.createEl("div");
		const identityContainer = containerEl.createEl("div", {
			attr: { style: "padding-top: 12px;" },
		});

		const presenter = new TeamsPresenter(
			this.app,
			this.settings,
			this.actions
		);
		presenter.mount(teamsListContainer, identityContainer, () =>
			this.display()
		);

		// Project View section
		containerEl.createEl("h3", { text: "Project View" });
		new Setting(containerEl)
			.setName("Toggle Sections")
			.setDesc(
				"Select which sections to display in project view. Sections with no tasks are hidden by default."
			)
			.setClass("setting-item-description");

		new Setting(containerEl)
			.setName("🎯 Objectives (OKRs)")
			.addToggle((toggle) =>
				toggle
					.setValue(this.settings.showObjectives)
					.onChange(async (value) => {
						this.settings.showObjectives = value;
						await this.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("🔨 Tasks (Subtasks)")
			.addToggle((toggle) =>
				toggle
					.setValue(this.settings.showTasks)
					.onChange(async (value) => {
						this.settings.showTasks = value;
						await this.saveSettings();
					})
			);

		new Setting(containerEl).setName("📝 Stories").addToggle((toggle) =>
			toggle
				.setValue(this.settings.showStories)
				.onChange(async (value) => {
					this.settings.showStories = value;
					await this.saveSettings();
				})
		);

		new Setting(containerEl).setName("🏆 Epics").addToggle((toggle) =>
			toggle.setValue(this.settings.showEpics).onChange(async (value) => {
				this.settings.showEpics = value;
				await this.saveSettings();
			})
		);

		new Setting(containerEl).setName("🎖️ Initiatives").addToggle((toggle) =>
			toggle
				.setValue(this.settings.showInitiatives)
				.onChange(async (value) => {
					this.settings.showInitiatives = value;
					await this.saveSettings();
				})
		);

		new Setting(containerEl)
			.setName("🧹 Responsibilities")
			.addToggle((toggle) =>
				toggle
					.setValue(this.settings.showResponsibilities)
					.onChange(async (value) => {
						this.settings.showResponsibilities = value;
						await this.saveSettings();
					})
			);

		new Setting(containerEl).setName("📁 Priorities").addToggle((toggle) =>
			toggle
				.setValue(this.settings.showPriorities)
				.onChange(async (value) => {
					this.settings.showPriorities = value;
					await this.saveSettings();
				})
		);

		// Appearance
		containerEl.createEl("h3", { text: "Appearance" });
		new Setting(containerEl)
			.setName("Custom Task Styles")
			.setDesc(
				'Uses a customized version of SlRvb’s "Checkboxes" (ITS Theme). Turn off if your theme/snippet provides its own.'
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.settings.useBundledCheckboxes)
					.onChange(async (value) => {
						this.settings.useBundledCheckboxes = value;
						await this.saveSettings();
						await this.applyCheckboxStylesSetting();
					})
			);

		// Identity section at the end
		const identityPresenter = new IdentityPresenter(
			this.settings,
			this.saveSettings
		);
		identityPresenter.mount(identityContainer);
	}

	private getTeamsCount(): number {
		return this.settings.teams?.length ?? 0;
	}
}
