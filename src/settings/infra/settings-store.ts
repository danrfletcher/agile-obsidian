/**
 * Infrastructure: persistence defaults for settings.
 * Keep this file focused on static defaults and persistence glue (if added later).
 */
import type { AgileObsidianSettings } from "@settings";

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

	// Settings sections minimized by default
	uiFoldOrgStructure: true,
	uiFoldAgileDashboard: true,
	uiFoldUxShortcuts: true,

	// UX Shortcuts
	enableUxRepeatAgileTemplates: true,

	// Agile Task Formatting section (folded by default)
	uiFoldAgileTaskFormatting: true,

	// Canonical formatter defaults
	enableTaskCanonicalFormatter: true,
	enableCanonicalOnLineCommit: true,
	enableCanonicalOnLeafChange: true,

	// Metadata Cleanup defaults
	enableMetadataCleanup: true,
	enableMetadataCleanupOnStart: true,
	enableMetadataCleanupAtMidnight: true,
};
