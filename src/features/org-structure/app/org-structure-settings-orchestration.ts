import type { Container } from "src/composition/container";
import type { TeamsActions } from "src/features/settings/ui/presenters/teams-presenter";
import { hydrateTeamsFromVault } from "src/features/org-structure/domain/team-detection";
import { createTeamResources } from "src/features/org-structure/app/creation";
import {
	createOrganizationFromTeam,
	addTeamsToExistingOrganization,
	createSubteams,
} from "src/features/org-structure/domain/organizations";
import { slugifyName } from "src/features/identities/slug-utils";
import type {
	AgileObsidianSettings,
	TeamInfo,
	MemberInfo,
} from "src/features/settings/settings.types";
import type { Plugin } from "obsidian";

type MutableSettingsForHydration = {
	teamsFolder: string;
	teams?: TeamInfo[];
	[k: string]: unknown;
};

export function registerOrgStructureSettings(
	container: Container
): TeamsActions {
	const { app, plugin, settings } = container;
	const p = plugin as Plugin & {
		saveSettings?: () => Promise<void>;
		saveData?: (data: AgileObsidianSettings) => Promise<void>;
	};

	async function saveSettings() {
		if (typeof p.saveSettings === "function") await p.saveSettings();
		else if (typeof p.saveData === "function") await p.saveData(settings);
	}

	return {
		detectAndUpdateTeams: async () => {
			await hydrateTeamsFromVault(
				app.vault,
				settings as unknown as MutableSettingsForHydration
			);
			await saveSettings();
		},
		saveSettings: async () => {
			await saveSettings();
		},
		createTeam: async (teamName, parentPath, teamSlug, _code) => {
			const res = await createTeamResources(
				app,
				teamName,
				parentPath,
				teamSlug
			);
			const info = res.info as {
				name: string;
				slug?: string;
				rootPath: string;
				members?: MemberInfo[];
			};
			const idx = (settings.teams || []).findIndex(
				(t: TeamInfo) =>
					t.name === info.name && t.rootPath === info.rootPath
			);
			const normalized: TeamInfo = {
				name: info.name,
				rootPath: info.rootPath,
				slug: info.slug,
				members: Array.isArray(info.members) ? info.members : [],
			};
			if (idx === -1)
				(settings.teams || (settings.teams = [])).push(normalized);
			else settings.teams[idx] = normalized;
			await saveSettings();
		},
		createOrganizationFromTeam: async (
			team: TeamInfo,
			orgName: string,
			suffixes: string[]
		) => {
			const teamInfo: TeamInfo = {
				...(team as TeamInfo),
				members: team.members || [],
			};
			await createOrganizationFromTeam({
				app,
				orgName,
				orgSlug: slugifyName(orgName),
				team: teamInfo,
				suffixes,
			});
		},
		addTeamsToExistingOrganization: async (
			org: TeamInfo,
			orgName: string,
			suffixes: string[]
		) => {
			const orgInfo: TeamInfo = {
				...(org as TeamInfo),
				members: org.members || [],
			};
			await addTeamsToExistingOrganization(
				app,
				orgInfo,
				orgName,
				suffixes
			);
		},
		createSubteams: async (parentTeam: TeamInfo, suffixes: string[]) => {
			await createSubteams(app, parentTeam, suffixes);
		},
	};
}
