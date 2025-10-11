import type { Container } from "./container";
import { registerAgileDashboardView } from "@features/agile-dashboard-view";
import { registerTemplatingDynamicCommands } from "@features/templating-engine";
import { registerTaskAssignmentDynamicCommands } from "@features/task-assignment";

/**
 * Registers all user-facing commands.
 * Safe to call early; will opportunistically inject TaskIndex/OrgStructure ports if available.
 */
export async function registerAllCommands(container: Container) {
	// Feature: Agile dashboard view
	await registerAgileDashboardView(container);

	// Feature: Dynamic template commands based on cursor context
	await registerTemplatingDynamicCommands(
		container.app,
		container.plugin as any,
		container.manifestId,
		container.taskIndexService
			? {
					taskIndex: {
						getItemAtCursor: (cursor) =>
							container.taskIndexService!.getItemAtCursor(
								cursor
							) as any,
						getTaskByBlockRef: (ref) =>
							container.taskIndexService!.getTaskByBlockRef(
								ref
							) as any,
					},
			  }
			: undefined
	);

	// Feature: Task assignment commands (members + special "Everyone")
	if (container.orgStructurePorts?.orgStructure) {
		await registerTaskAssignmentDynamicCommands(
			container.app,
			container.plugin as any,
			container.manifestId,
			{ orgStructure: container.orgStructurePorts.orgStructure }
		);
	}
}
