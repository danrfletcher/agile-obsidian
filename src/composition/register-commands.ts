import type { Container } from "./container";
import { registerAgileDashboardView } from "@features/agile-dashboard-view";
import {
	registerTemplatingDynamicCommands,
} from "@features/templating-engine";
import type { TaskIndexPort } from "@features/templating-engine";
import { registerTaskAssignmentDynamicCommands } from "@features/task-assignment";

/**
 * Registers all user-facing commands.
 * Safe to call early; will opportunistically inject TaskIndex/OrgStructure ports if available.
 */
export async function registerAllCommands(container: Container): Promise<void> {
	// Feature: Agile dashboard view
	await registerAgileDashboardView(container);

	// Feature: Dynamic template commands based on cursor context
	const taskIndexPorts: { taskIndex: TaskIndexPort } | undefined =
		container.taskIndexService
			? {
					taskIndex: {
						getItemAtCursor: (cursor) =>
							container.taskIndexService!.getItemAtCursor(
								cursor
							),
						getTaskByBlockRef: (ref) =>
							container.taskIndexService!.getTaskByBlockRef(ref),
					},
			  }
			: undefined;

	await registerTemplatingDynamicCommands(
		container.app,
		container.plugin as Parameters<
			typeof registerTemplatingDynamicCommands
		>[1],
		container.manifestId,
		taskIndexPorts
	);

	// Feature: Task assignment commands (members + special "Everyone")
	if (container.orgStructurePorts?.orgStructure) {
		await registerTaskAssignmentDynamicCommands(
			container.app,
			container.plugin as Parameters<
				typeof registerTaskAssignmentDynamicCommands
			>[1],
			container.manifestId,
			{ orgStructure: container.orgStructurePorts.orgStructure }
		);
	}
}