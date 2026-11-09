import type { AgileObsidianSettings } from "../domain/settings-types";

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
	};
}
