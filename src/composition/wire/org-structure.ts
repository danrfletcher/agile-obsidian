import type { Container } from "../container";
import type { OrgStructurePort } from "@features/org-structure";
import { createOrgStructureService } from "@features/org-structure";
import { registerTaskAssignmentDynamicCommands } from "@features/task-assignment";

/**
 * Boots Org Structure service and wires vault watchers (debounced).
 * Exposes ports on the container and registers assignment commands.
 */
export async function wireOrgStructure(container: Container): Promise<{
	orgStructurePort: OrgStructurePort;
	dispose: () => void;
}> {
	const { app, plugin } = container;
	const orgStructureService = createOrgStructureService({
		app,
		settings: container.settings,
	});
	await orgStructureService.buildAll();

	let rebuildTimer: number | null = null;
	const scheduleRebuild = () => {
		if (rebuildTimer != null) window.clearTimeout(rebuildTimer);
		rebuildTimer = window.setTimeout(() => {
			rebuildTimer = null;
			// fire and forget
			orgStructureService["buildAll"]();
		}, 200);
	};

	plugin.registerEvent(app.vault.on("create", scheduleRebuild));
	plugin.registerEvent(app.vault.on("modify", scheduleRebuild));
	plugin.registerEvent(app.vault.on("delete", scheduleRebuild));
	plugin.registerEvent(app.vault.on("rename", scheduleRebuild));

	const orgStructurePort: OrgStructurePort = {
		getOrgStructure: orgStructureService.getOrgStructure,
		getTeamMembersForFile: orgStructureService.getTeamMembersForPath,
	};

	type ContainerWithOrg = Container & {
		orgStructureService: typeof orgStructureService;
		orgStructurePorts: { orgStructure: OrgStructurePort };
	};
	(container as ContainerWithOrg).orgStructureService = orgStructureService;
	(container as ContainerWithOrg).orgStructurePorts = {
		orgStructure: orgStructurePort,
	};

	try {
		await registerTaskAssignmentDynamicCommands(
			app,
			plugin,
			plugin.manifest.id,
			{
				orgStructure: orgStructurePort,
			}
		);
	} catch (e) {
		console.error("[boot] assignment commands failed", e);
	}

	return {
		orgStructurePort,
		dispose: () => {
			if (rebuildTimer != null) {
				window.clearTimeout(rebuildTimer);
				rebuildTimer = null;
			}
		},
	};
}
