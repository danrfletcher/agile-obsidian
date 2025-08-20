/**
 * Simple sample modal used by sample commands.
 *
 * In-app context:
 * - Demonstrates how to open a modal; a container for future sample/demo components.
 *
 * Plugin value:
 * - Keeps sample/demo artifacts organized under a dedicated folder.
 */
import { App, Modal } from "obsidian";

export class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.setText("Woah!");
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
