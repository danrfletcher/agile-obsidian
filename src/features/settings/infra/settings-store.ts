import type {
	AgileObsidianSettings,
	TeamInfo,
} from "src/features/settings/settings.types";

export const DEFAULT_SETTINGS: AgileObsidianSettings = {
	showObjectives: true,
	showTasks: true,
	showStories: true,
	showEpics: true,
	showInitiatives: true,
	showResponsibilities: true,
	showPriorities: true,
	useBundledCheckboxes: true,
	currentUserAlias: null,
	teamsFolder: "Teams",
	teams: [],
};

// Helpers kept small and pure
export function getCurrentUserAlias(
	settings: AgileObsidianSettings
): string | null {
	return settings.currentUserAlias ?? null;
}

export function getMemberDisplayNameByAlias(
	teams: TeamInfo[],
	alias: string
): string | null {
	if (!alias) return null;
	for (const t of teams ?? []) {
		for (const m of t.members ?? []) {
			if ((m.alias ?? "") === alias) return m.name ?? alias;
		}
	}
	return null;
}

export function getCurrentUserDisplayName(
	settings: AgileObsidianSettings
): string | null {
	const alias = getCurrentUserAlias(settings);
	if (!alias) return null;
	return getMemberDisplayNameByAlias(settings.teams ?? [], alias);
}
