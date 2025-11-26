import type { Plugin, App } from "obsidian";
import type { AgileObsidianSettings } from "@settings";
import type { SettingsService } from "@settings";
import { createSettingsService } from "@settings";
import type { OrgStructurePort } from "@features/org-structure";
import type { TeamInfo } from "@features/org-structure";
import type { OrgStructureResult } from "@features/org-structure";
import type { TaskIndexService } from "@features/task-index";

/**
 * The composition container provides access to the Obsidian plugin runtime,
 * live settings, and feature ports/services that are wired at boot.
 *
 * Important: `settings` is a "live-view" getter so consumers never read stale
 * snapshots if the settings object is replaced by the settings module.
 */
export interface Container {
	plugin: Plugin;
	app: App;

	/**
	 * Live view of plugin settings. Getter-backed to always reflect current settings.
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
			buckets: unknown;
			team: TeamInfo | null;
		};
	};
	orgStructurePorts?: { orgStructure: OrgStructurePort };
}

/**
 * Create the composition container for the plugin.
 */
export function createContainer(
	plugin: Plugin & { settings: AgileObsidianSettings }
): Container {
	const app = plugin.app as App;

	const settingsService = createSettingsService(() => plugin.settings);

	type ContainerWithoutSettings = Omit<Container, "settings">;

	const container: ContainerWithoutSettings = {
		plugin,
		app,
		settingsService,
		manifestId: sanitizeScopeId(plugin.manifest?.id ?? ""),
	};

	Object.defineProperty(container, "settings", {
		get() {
			return plugin.settings;
		},
		set(_v: AgileObsidianSettings) {
			// No-op to prevent external mutation; settings are plugin-owned.
		},
		enumerable: true,
		configurable: false,
	});

	return container as Container;
}

/** Defensive sanitize for any DOM/CSS scoping usage (e.g., style injection). */
function sanitizeScopeId(id: string): string {
	return (id ?? "").replace(/[^a-zA-Z0-9._:-]+/g, "-");
}