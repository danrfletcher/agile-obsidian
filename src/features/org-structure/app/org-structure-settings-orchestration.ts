import type { App, Plugin } from "obsidian";
import type { TeamsActions } from "@settings/ui/presenters/teams-presenter";
import { hydrateTeamsFromVault } from "src/features/org-structure/domain/org-detection";
import {
	createTeamResources,
	createOrganizationFromTeam,
	addTeamsToExistingOrganization,
	createSubteams,
} from "src/features/org-structure/domain/org-management";
import type { AgileObsidianSettings } from "src/settings";
import { slugifyName } from "@shared/identity";
import type { MemberInfo, TeamInfo } from "../domain/org-types";

export function registerOrgStructureSettings(ports: {
	app: App;
	plugin: Plugin;
	settings: AgileObsidianSettings;
	saveSettings: () => Promise<void>;
}): TeamsActions {
	const { app, plugin, settings } = ports;
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
			await hydrateTeamsFromVault(app.vault, settings);
			await saveSettings();
		},
		saveSettings: async () => {
			await saveSettings();
		},
		createTeam: async (teamName, parentPath, teamSlug, _code, options) => {
			const res = await createTeamResources(
				app,
				teamName,
				parentPath,
				teamSlug,
				/* resourcePathIdOverride */ null,
				/* seedWithSampleData */ !!options?.seedWithSampleData
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
				...team,
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
				...org,
				members: org.members || [],
			};
			await addTeamsToExistingOrganization(app, orgInfo, orgName, suffixes);
		},
		createSubteams: async (parentTeam: TeamInfo, suffixes: string[]) => {
			await createSubteams(app, parentTeam, suffixes);
		},
	};
}