import { TFolder, Vault } from "obsidian";
import {
	parseTeamFolderName,
	aliasToName,
} from "../utils/commands/commandUtils";
import { getFolder } from "../files/fsUtils";

export interface TeamInfo {
	name: string;
	slug: string;
	rootPath: string; // e.g., "Teams/My Team (my-team-abcd)"
	membersPath?: string; // optional sub-folder path
	displayName?: string; // normalized human display name
}

/**
 * Scan a parent folder for team folders that follow the slug pattern.
 * Returns list of TeamInfo sorted by display name.
 */
export function detectTeamsUnder(vault: Vault, parentPath: string): TeamInfo[] {
	const parent = getFolder(vault, parentPath);
	if (!parent) return [];

	const teams: TeamInfo[] = [];

	for (const child of parent.children) {
		if (!(child instanceof TFolder)) continue;
		const parsed = parseTeamFolderName(child.name);
		if (!parsed) continue;

		// parsed: { name, slug }
		teams.push({
			name: parsed.name,
			slug: parsed.slug,
			rootPath: child.path,
			displayName: aliasToName(parsed.name),
		});
	}

	teams.sort((a, b) => a.displayName!.localeCompare(b.displayName!));
	return teams;
}

/**
 * Updates settings.teams by scanning the parent teams folder.
 * Returns the count of detected teams.
 */
export function updateSettingsTeams(
	vault: Vault,
	settings: { teamsFolder: string; teams?: TeamInfo[]; [k: string]: any }
): number {
	const parent = settings.teamsFolder || "Teams";
	const detected = detectTeamsUnder(vault, parent);
	settings.teams = detected;
	return detected.length;
}
