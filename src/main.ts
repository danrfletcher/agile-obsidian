import { Plugin } from "obsidian";
import { AgileSettingTab } from "./settings/settings.ui";
import { DEFAULT_SETTINGS } from "./settings/settings.store";
import type {
	AgileObsidianSettings,
	TeamInfo,
} from "./settings/settings.types";
import { hydrateTeamsFromVault } from "./teams/teamDetection";
import {
	createOrganizationFromTeam,
	addTeamsToExistingOrganization,
	createSubteams,
} from "./teams/organizations";
import { createTeamResources } from "./teams/teamCreation";
import { slugifyName } from "./utils/commands/commandUtils";
import {
	injectCheckboxStyles,
	removeCheckboxStyles,
} from "./styles/injection";

export default class AgileObsidianPlugin extends Plugin {
	settings: AgileObsidianSettings;

	async onload() {
		await this.loadSettings();
		await this.applyCheckboxStylesSetting();

		// Settings Tab (thin UI shell)
		this.addSettingTab(
			new AgileSettingTab(
				this.app,
				this,
				this.settings,
				{
					detectAndUpdateTeams: async () => {
						await hydrateTeamsFromVault(
							this.app.vault,
							this.settings as unknown as {
								teamsFolder: string;
								teams?: TeamInfo[]; // type name here just needs compatible shape; settings.types.TeamInfo matches
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
							app: this.app,
							orgName,
							orgSlug: slugifyName(orgName),
							team: team as TeamInfo,
							suffixes,
						});
					},
					addTeamsToExistingOrganization: async (
						org,
						orgName,
						suffixes
					) => {
						await addTeamsToExistingOrganization(
							this.app,
							org as TeamInfo,
							orgName,
							suffixes
						);
					},
					createSubteams: async (parentTeam, suffixes) => {
						await createSubteams(
							this.app,
							parentTeam as TeamInfo,
							suffixes
						);
					},
				},
				() => this.saveSettings(),
				() => this.applyCheckboxStylesSetting()
			)
		);
	}

	onunload() {
		removeCheckboxStyles(this.manifest.id);
	}

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
		if (this.settings.useBundledCheckboxes) {
			injectCheckboxStyles(this.manifest.id);
		} else {
			removeCheckboxStyles(this.manifest.id);
		}
	}
}
