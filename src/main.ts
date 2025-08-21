import { Plugin } from "obsidian";
import { AgileSettingTab } from "./settings/settings.ui";
import { DEFAULT_SETTINGS } from "./settings/settings.store";
import type {
	AgileObsidianSettings,
} from "./settings/settings.types";
import { updateSettingsTeams } from "./teams/teamDetection";
import type { TeamInfo as DetectedTeamInfo } from "./teams/teamDetection";
import {
	createOrganizationFromTeam,
	addTeamsToExistingOrganization,
	createSubteams,
} from "./teams/organizations";
import { createTeamResources } from "./teams/teamCreation";
import { slugifyName } from "./utils/commands/commandUtils";

export default class AgileObsidianPlugin extends Plugin {
	settings: AgileObsidianSettings;

	async onload() {
		await this.loadSettings();

		// Settings Tab (thin UI shell)
		this.addSettingTab(
			new AgileSettingTab(
				this.app,
				this,
				this.settings,
				{
					detectAndUpdateTeams: async () => {
						updateSettingsTeams(
							this.app.vault,
							this.settings as unknown as {
								teamsFolder: string;
								teams?: DetectedTeamInfo[];
								[k: string]: any;
							}
						);
						await this.saveSettings();
					},
					saveSettings: async () => {
						await this.saveSettings();
					},
					createTeam: async (
						teamName,
						parentPath,
						teamSlug,
						_code
					) => {
						const { info } = await createTeamResources(
							this.app,
							teamName,
							parentPath,
							teamSlug
						);
						const idx = this.settings.teams.findIndex(
							(t) =>
								t.name === info.name &&
								t.rootPath === info.rootPath
						);
						if (idx === -1) this.settings.teams.push(info);
						else this.settings.teams[idx] = info;
						await this.saveSettings();
					},
					createOrganizationFromTeam: async (
						team,
						orgName,
						suffixes
					) => {
						await createOrganizationFromTeam({
							vault: this.app.vault,
							orgName,
							orgSlug: slugifyName(orgName),
							team: team as DetectedTeamInfo,
						});
					},
					addTeamsToExistingOrganization: async (
						org,
						orgName,
						suffixes
					) => {
						await addTeamsToExistingOrganization(
							this.app,
							org as DetectedTeamInfo,
							orgName,
							suffixes,
						);
					},
					createSubteams: async (parentTeam, suffixes) => {
						await createSubteams(this.app, parentTeam as DetectedTeamInfo, suffixes);
					},
				},
				() => this.saveSettings(),
				() => this.applyCheckboxStylesSetting()
			)
		);
	}

	onunload() {}

	async loadSettings() {
		const data = await this.loadData();
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			data
		) as AgileObsidianSettings;
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// Toggle bundled checkbox CSS (wired from settings UI)
	async applyCheckboxStylesSetting() {
		// Implement your stylesheet injection/removal here if needed.
		// Kept as a no-op placeholder because settings.ui.ts calls it.
	}
}
