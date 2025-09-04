/**
 * Public app-level contracts (ports) for the Settings feature.
 * These describe dependencies that the Settings UI uses from the org-structure feature.
 */
import type { TeamInfo } from "@features/org-structure";

/**
 * Actions related to teams/orgs that the Settings UI invokes.
 * Implemented externally (e.g., in org-structure feature) and injected into settings.
 */
export interface SettingsOrgActions {
	/**
	 * Re-scan vault and reconcile the in-memory teams/orgs model.
	 */
	detectAndUpdateTeams: () => Promise<void>;

	/**
	 * Persist the current settings state.
	 */
	saveSettings: () => Promise<void>;

	/**
	 * Create a team at a specific parent folder with a specific slug and code.
	 * - teamSlug should include the 6-char code (e.g., "engineering-1ab2cd").
	 * - code must be a 6-char string matching /^[0-9][a-z0-9]{5}$/i.
	 */
	createTeam: (
		teamName: string,
		parentPath: string,
		teamSlug: string,
		code: string
	) => Promise<void>;

	/**
	 * Create an organization from an existing team, producing multiple child teams.
	 */
	createOrganizationFromTeam: (
		team: TeamInfo,
		orgName: string,
		suffixes: string[]
	) => Promise<void>;

	/**
	 * Add new teams under an existing organization.
	 */
	addTeamsToExistingOrganization: (
		org: TeamInfo,
		orgName: string,
		suffixes: string[]
	) => Promise<void>;

	/**
	 * Create subteams under the provided parent team.
	 */
	createSubteams: (parentTeam: TeamInfo, suffixes: string[]) => Promise<void>;
}
