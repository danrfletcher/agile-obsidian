/**
 * Infrastructure: persistence defaults for settings.
 * Keep this file focused on static defaults and persistence glue (if added later).
 */
import type { AgileObsidianSettings } from "../domain/settings-types";

export const DEFAULT_SETTINGS: AgileObsidianSettings = {
	// Settings sections minimized by default
	uiFoldUxShortcuts: true,

	// UX Shortcuts
	enableUxRepeatAgileTemplates: true,

	// Agile Task Formatting section (folded by default)
	uiFoldAgileTaskFormatting: true,

	// Canonical formatter defaults
	enableTaskCanonicalFormatter: true,
	enableCanonicalOnLineCommit: true,
	enableCanonicalOnLeafChange: true,
};
