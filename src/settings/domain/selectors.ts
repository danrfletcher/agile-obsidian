/**
 * Domain-level selectors for settings data.
 * Pure functions without side-effects.
 */
import { TeamInfo } from "@features/org-structure";
import type { AgileObsidianSettings } from "./settings-types";

/**
 * Returns the current user's alias or null if unset.
 */
export function getCurrentUserAlias(
	settings: AgileObsidianSettings
): string | null {
	return settings.currentUserAlias ?? null;
}

/**
 * Returns a member's display name for a given alias by scanning teams, or null if not found.
 * If a member name is missing, returns the alias as a fallback.
 */
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

/**
 * Convenience selector: gets the current user's display name, or null if unset or not found.
 */
export function getCurrentUserDisplayName(
	settings: AgileObsidianSettings
): string | null {
	const alias = getCurrentUserAlias(settings);
	if (!alias) return null;
	return getMemberDisplayNameByAlias(settings.teams ?? [], alias);
}
