import type { Container } from "./container";
import { registerTemplatingDynamicCommands } from "@features/templating-engine";

/**
 * Registers all user-facing commands.
 */
export async function registerAllCommands(container: Container): Promise<void> {
	// Feature: Dynamic template commands based on cursor context
	await registerTemplatingDynamicCommands(
		container.app,
		container.plugin,
		container.manifestId
	);
}
