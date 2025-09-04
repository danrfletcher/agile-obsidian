import type { Plugin, App } from "obsidian";
import type { AgileObsidianSettings } from "@settings";
import type { SettingsService } from "@settings";
import { createSettingsService } from "@settings";
import type { OrgStructurePort } from "@features/org-structure";
import type { TeamInfo } from "@features/org-structure";
import type {
	OrgStructureResult,
} from "@features/org-structure";

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
			buckets: any;
			team: TeamInfo | null;
		};
	};
	orgStructurePorts?: { orgStructure: OrgStructurePort };
}

export function createContainer(
	plugin: Plugin & { settings: AgileObsidianSettings }
): Container {
	const app = (plugin as any).app as App;
	const settings = (plugin as any).settings as AgileObsidianSettings;

	const settingsService = createSettingsService(
		() => (plugin as any).settings
	);

	return {
		plugin,
		app,
		settings,
		settingsService,
		manifestId: (plugin as any).manifest?.id ?? "",
	};
}
