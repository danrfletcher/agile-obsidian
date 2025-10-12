import type { AgileObsidianSettings } from "../domain/settings-types";
import {
	getCurrentUserAlias,
	getCurrentUserDisplayName,
	getMemberDisplayNameByAlias,
} from "../domain/selectors";
import { TeamInfo } from "@features/org-structure";

export interface SettingsService {
	/**
	 * Returns a live snapshot of current settings.
	 * Prefer this in runtime gating to avoid stale reads.
	 */
	get(): AgileObsidianSettings;

	/**
	 * Alias for get() for backwards compatibility with older call sites.
	 */
	getRaw(): AgileObsidianSettings;

	getCurrentUserAlias(): string | null;
	getCurrentUserDisplayName(): string | null;
	getMemberDisplayNameByAlias(alias: string): string | null;
	getTeams(): TeamInfo[];
}

export function createSettingsService(
	getSettings: () => AgileObsidianSettings
): SettingsService {
	const getLive = () => getSettings();

	return {
		get() {
			return getLive();
		},
		getRaw() {
			// Back-compat alias
			return getLive();
		},
		getCurrentUserAlias() {
			return getCurrentUserAlias(getLive());
		},
		getCurrentUserDisplayName() {
			return getCurrentUserDisplayName(getLive());
		},
		getMemberDisplayNameByAlias(alias: string) {
			return getMemberDisplayNameByAlias(getLive().teams ?? [], alias);
		},
		getTeams() {
			return getLive().teams ?? [];
		},
	};
}
