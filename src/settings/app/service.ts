import type { AgileObsidianSettings } from "../domain/settings-types";
import {
	getCurrentUserAlias,
	getCurrentUserDisplayName,
	getMemberDisplayNameByAlias,
} from "../domain/selectors";
import { TeamInfo } from "@features/org-structure";

export interface SettingsService {
	getCurrentUserAlias(): string | null;
	getCurrentUserDisplayName(): string | null;
	getMemberDisplayNameByAlias(alias: string): string | null;
	getTeams(): TeamInfo[];
	getRaw(): AgileObsidianSettings;
}

export function createSettingsService(
	getSettings: () => AgileObsidianSettings
): SettingsService {
	return {
		getCurrentUserAlias() {
			return getCurrentUserAlias(getSettings());
		},
		getCurrentUserDisplayName() {
			return getCurrentUserDisplayName(getSettings());
		},
		getMemberDisplayNameByAlias(alias: string) {
			return getMemberDisplayNameByAlias(
				getSettings().teams ?? [],
				alias
			);
		},
		getTeams() {
			return getSettings().teams ?? [];
		},
		getRaw() {
			return getSettings();
		},
	};
}
