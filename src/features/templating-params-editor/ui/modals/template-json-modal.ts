import { App, Modal, Notice } from "obsidian";
import type { TemplateParams } from "../../domain/types";

export async function showJsonModal(
	app: App,
	templateId: string,
	initialJson?: string
): Promise<TemplateParams | undefined> {
	return new Promise((resolve) => {
		const modal = new (class extends Modal {
			private textarea!: HTMLTextAreaElement;
			private resolved = false;

			onOpen(): void {
				this.titleEl.setText(`Params for ${templateId}`);
				const { contentEl } = this;

				const para = contentEl.createEl("p", {
					text: 'Enter template params as JSON (optional). Example: {"title":"My Title"}',
				});
				para.style.marginBottom = "8px";

				this.textarea = contentEl.createEl("textarea", {
					attr: { rows: "10", style: "width: 100%;" },
				});
				if (initialJson) this.textarea.value = initialJson;

				const btnRow = contentEl.createEl("div", {
					attr: { style: "display:flex; gap:8px; margin-top: 12px;" },
				});

				const okBtn = btnRow.createEl("button", { text: "Apply" });
				const cancelBtn = btnRow.createEl("button", { text: "Cancel" });

				okBtn.addEventListener("click", () => {
					if (this.resolved) return;
					this.resolved = true;
					const v = this.textarea.value.trim();
					if (!v) {
						this.close();
						resolve(undefined);
						return;
					}
					try {
						const parsed = JSON.parse(v) as TemplateParams;
						this.close();
						resolve(parsed);
					} catch (e) {
						const msg = (e as Error)?.message ?? "Parse error";
						new Notice(`Invalid JSON: ${msg}`);
						this.resolved = false;
					}
				});

				cancelBtn.addEventListener("click", () => {
					if (this.resolved) return;
					this.resolved = true;
					this.close();
					resolve(undefined);
				});
			}

			onClose(): void {
				this.contentEl.empty();
			}
		})(app);

		modal.open();
	});
}