import { Plugin, TFile, Notice } from "obsidian";
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
import {
	getUncheckedTasksFromFile,
	toggleTaskAtLine,
} from "./tasks/taskOperations";
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
				this.settings,
				{
					detectAndUpdateTeams: async () => {
						updateSettingsTeams(this.app.vault, this.settings);
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
							team: team as DetectedTeamInfo,
							orgName,
							orgSlug: slugifyName(orgName),
						});
					},
					addTeamsToExistingOrganization: async (
						org,
						orgName,
						suffixes
					) => {
						await addTeamsToExistingOrganization({
							app: this.app,
							org,
							orgName,
							suffixes,
						});
					},
					createSubteams: async (parentTeam, suffixes) => {
						await createSubteams({
							app: this.app,
							parentTeam: parentTeam as DetectedTeamInfo,
							suffixes,
						});
					},
				},
				() => this.saveSettings(),
				() => this.applyCheckboxStylesSetting()
			)
		);

		// Command: Update Teams
		this.addCommand({
			id: "agile-update-teams",
			name: "Update Teams",
			callback: async () => {
				const count = updateSettingsTeams(
					this.app.vault,
					this.settings
				);
				await this.saveSettings();
				new Notice(`Detected ${count} team(s).`);
			},
		});

		// Command: Create organization from selected team (demo)
		this.addCommand({
			id: "agile-create-organization-from-team",
			name: "Create Organization from Selected Team",
			callback: async () => {
				try {
					// Demo: pick first team (replace with your selection UI/modal)
					const team = this.settings.teams?.[0];
					if (!team) {
						new Notice("No team selected or detected.");
						return;
					}

					// Demo: simple defaults — replace with CreateOrganizationModal
					const orgName = "Acme";
					const suffixes = ["A", "B"];

					await createOrganizationFromTeam({
						vault: this.app.vault,
						team: team as DetectedTeamInfo,
						orgName,
						orgSlug: slugifyName(orgName),
					});

					// Refresh teams
					updateSettingsTeams(this.app.vault, this.settings);
					await this.saveSettings();
					new Notice(`Organization "${orgName}" created.`);
				} catch (e: any) {
					console.error(e);
					new Notice(e?.message ?? "Failed to create organization");
				}
			},
		});

		// Command: Toggle task in active file at cursor line
		this.addCommand({
			id: "agile-toggle-task-at-cursor",
			name: "Toggle Task at Cursor",
			editorCallback: async (editor, view) => {
				const file = view?.file;
				if (!(file instanceof TFile)) return;
				const line = editor.getCursor().line;
				await toggleTaskAtLine(this.app, file, line);
			},
		});

		// Example: On file open, list unchecked tasks (demo hook)
		this.registerEvent(
			this.app.workspace.on("file-open", async (file) => {
				if (!(file instanceof TFile)) return;
				const tasks = await getUncheckedTasksFromFile(this.app, file);
				// TODO: index/process tasks as needed
			})
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
