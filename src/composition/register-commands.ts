import type { Container } from "./container";
import {
	registerTemplatingDynamicCommands,
} from "@features/templating-engine";
import type { TaskIndexPort } from "@features/templating-engine";

/**
 * Registers all user-facing commands.
 * Safe to call early; will opportunistically inject TaskIndex ports if available.
 */
export async function registerAllCommands(container: Container): Promise<void> {
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
		container.plugin,
		container.manifestId,
		taskIndexPorts
	);
}
