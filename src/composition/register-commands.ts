import type { Container } from "./container";
import { Notice } from "obsidian";
import { registerTemplatingDynamicCommands } from "@features/templating-engine";
import { formatNoteTaskLines } from "@features/task-canonical-formatter";

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

	// Feature: per-note canonical formatting command
	registerFormatNoteCommand(container);
}

/**
 * "Format all task lines in this note". Listed in the palette only while the master
 * canonical formatter toggle is on (checked live each time the palette asks). No
 * default hotkey.
 */
export function registerFormatNoteCommand(container: Container): void {
	container.plugin.addCommand({
		id: "format-all-task-lines-in-note",
		name: "Format all task lines in this note",
		editorCheckCallback: (checking, editor) => {
			if (!container.settings.enableTaskCanonicalFormatter) return false;
			if (checking) return true;
			void formatNoteTaskLines(editor)
				.then((n) => {
					new Notice(
						n > 0
							? `Reordered chips on ${n} task line(s).`
							: "Task lines are already in order."
					);
				})
				.catch((e) => {
					new Notice(
						`Formatting failed: ${e instanceof Error ? e.message : String(e)}`
					);
				});
			return true;
		},
	});
}
