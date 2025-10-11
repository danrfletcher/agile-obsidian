import type { Plugin, App } from "obsidian";
import type { AgileObsidianSettings } from "@settings";
import type { SettingsService } from "@settings";
import { createSettingsService } from "@settings";
import type { OrgStructurePort } from "@features/org-structure";
import type { TeamInfo } from "@features/org-structure";
import type { OrgStructureResult } from "@features/org-structure";
import type { TaskIndexService } from "@features/task-index";

export interface Container {
	plugin: Plugin;
	app: App;

	/**
	 * Live view of plugin settings. This is a getter-backed property that always
	 * returns the current plugin.settings so readers don't see stale snapshots
	 * if the settings module replaces the object.
	 */
	settings: AgileObsidianSettings;

	settingsService: SettingsService;
	manifestId: string;

	// Wiring ports (optional) to keep features decoupled from composition
	taskIndexService?: TaskIndexService;

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

	// Settings service: provide a function that returns the current settings object.
	// If your settings module replaces plugin.settings, this will still pick up the new object.
	const settingsService = createSettingsService(
		() => (plugin as any).settings
	);

	// Build a base container and then define a getter-backed "settings" property
	// so consumers always see the latest plugin.settings object.
	const container: any = {
		plugin,
		app,
		settingsService,
		manifestId: (plugin as any).manifest?.id ?? "",
	};

	Object.defineProperty(container, "settings", {
		get() {
			return (plugin as any).settings as AgileObsidianSettings;
		},
		set(_v: AgileObsidianSettings) {
			// Ignore external sets to avoid desync; settings are owned by the plugin.
			// This keeps "container.settings" as a live view only.
		},
		enumerable: true,
		configurable: false,
	});

	return container as Container;
}
