import { App, Modal } from "obsidian";

export type ConfirmOptions = {
	title: string;
	message?: string;
	confirmText: string;
	cancelText?: string;
};

/**
 * Opens a confirm / cancel dialog. Resolves true only when the confirm button is
 * pressed; Cancel, Esc, clicking outside or closing the dialog any other way resolves false.
 */
export function confirmDialog(
	app: App,
	opts: ConfirmOptions
): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		let settled = false;
		const settle = (value: boolean) => {
			if (settled) return;
			settled = true;
			resolve(value);
		};

		class ConfirmModal extends Modal {
			onOpen(): void {
				this.setTitle(opts.title);
				const { contentEl } = this;
				if (opts.message) contentEl.createEl("p", { text: opts.message });

				const row = contentEl.createDiv({ cls: "modal-button-container" });
				const confirmBtn = row.createEl("button", {
					text: opts.confirmText,
					cls: "mod-cta",
				});
				const cancelBtn = row.createEl("button", {
					text: opts.cancelText ?? "Cancel",
				});

				confirmBtn.addEventListener("click", () => {
					settle(true);
					this.close();
				});
				cancelBtn.addEventListener("click", () => {
					settle(false);
					this.close();
				});
			}

			onClose(): void {
				this.contentEl.empty();
				// Esc, the close button or a click outside the dialog.
				settle(false);
			}
		}

		new ConfirmModal(app).open();
	});
}
