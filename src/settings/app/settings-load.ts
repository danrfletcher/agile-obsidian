/**
 * Pure settings-load logic: copy only known keys from stored data.
 * No Obsidian imports, so it is unit-testable in plain node.
 */
import { DEFAULT_SETTINGS } from "../infra/settings-store";
import type { AgileObsidianSettings } from "../domain/settings-types";

export interface LoadedSettings {
	settings: AgileObsidianSettings;
	/**
	 * True only when stored data carried keys that are not (or no longer) known
	 * settings and were dropped, so the cleaned object should be persisted once.
	 */
	needsSave: boolean;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Build a complete settings object from stored data.
 * - Known keys with the right type (same typeof as the default) are kept.
 * - Missing keys, or keys with the wrong type, take the default.
 * - Unknown keys are dropped and flag `needsSave`.
 * Does not mutate inputs.
 */
export function loadSettings(stored: unknown): LoadedSettings {
	const settings: AgileObsidianSettings = { ...DEFAULT_SETTINGS };
	if (!isPlainObject(stored)) return { settings, needsSave: false };

	const out = settings as unknown as Record<string, unknown>;
	const defaults = DEFAULT_SETTINGS as unknown as Record<string, unknown>;

	for (const key of Object.keys(defaults)) {
		if (!Object.prototype.hasOwnProperty.call(stored, key)) continue;
		const value = stored[key];
		if (typeof value === typeof defaults[key]) out[key] = value;
	}

	const needsSave = Object.keys(stored).some(
		(k) => !Object.prototype.hasOwnProperty.call(defaults, k)
	);
	return { settings, needsSave };
}
