import { TeamInfo } from "@features/org-structure";

export interface AgileObsidianSettings {
	showObjectives: boolean;
	showTasks: boolean;
	showStories: boolean;
	showEpics: boolean;
	showInitiatives: boolean;
	showResponsibilities: boolean;
	showPriorities: boolean;
	useBundledCheckboxes: boolean;
	currentUserAlias: string | null;
	teamsFolder: string;
	teams: TeamInfo[];

	/**
	 * UI fold state for Settings sections (persisted).
	 * Default: true (minimized)
	 */
	uiFoldOrgStructure: boolean;
	uiFoldAgileDashboard: boolean;
}
