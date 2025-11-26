import type { Plugin, App } from "obsidian";
import type { AgileObsidianSettings } from "@settings";
import type { SettingsService } from "@settings";
import { createSettingsService } from "@settings";
import type { OrgStructurePort } from "@features/org-structure";
import type { TeamInfo } from "@features/org-structure";
import type {
	OrgStructureResult,
} from "@features/org-structure";
import type { MembersBuckets } from "../domain/org-api-types";

export interface Container {
	plugin: Plugin;
	app: App;
	settings: AgileObsidianSettings;
	settingsService: SettingsService;
	manifestId: string;

	// Exposed at runtime by register-events
	orgStructureService?: {
		getOrgStructure: () => OrgStructureResult;
		getTeamMembersForPath: (path: string) => {
			members: TeamInfo["members"];
			buckets: MembersBuckets;
			team: TeamInfo | null;
		};
	};
	orgStructurePorts?: { orgStructure: OrgStructurePort };
}

export function createContainer(
	plugin: Plugin & { settings: AgileObsidianSettings }
): Container {
	const app = plugin.app;
	const settings = plugin.settings;

	const settingsService = createSettingsService(
		() => plugin.settings
	);

	return {
		plugin,
		app,
		settings,
		settingsService,
		manifestId: plugin.manifest.id,
	};
}