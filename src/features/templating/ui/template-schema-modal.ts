import { App, Modal, Notice } from "obsidian";
import type { ParamsSchema, ParamsSchemaField } from "../domain/types";
import { resolveModalTitleFromSchema } from "../app/templating-service";

export async function showSchemaModal(
	app: App,
	templateId: string,
	schema: ParamsSchema,
	isEdit = false
): Promise<Record<string, unknown> | undefined> {
	return new Promise((resolve) => {
		const modal = new (class extends Modal {
			private resolved = false;
			private inputs: Record<
				string,
				HTMLInputElement | HTMLTextAreaElement
			> = {};

			onOpen(): void {
				const { contentEl } = this;

				const title =
					resolveModalTitleFromSchema(schema, isEdit) ||
					schema.title ||
					`Parameters for ${templateId}`;
				this.titleEl.setText(title);

				if (schema.description) {
					const p = contentEl.createEl("p", {
						text: schema.description,
					});
					p.style.marginBottom = "8px";
				}

				let firstTextInputName: string | null = null;

				for (const field of (schema.fields ??
					[]) as ParamsSchemaField[]) {
					const wrap = contentEl.createEl("div", {
						attr: { style: "margin-bottom: 10px;" },
					});

					const labelEl = wrap.createEl("label", {
						text:
							(field.label ?? field.name) +
							(field.required ? " *" : ""),
					});
					labelEl.style.display = "block";
					labelEl.style.fontWeight = "600";
					labelEl.style.marginBottom = "4px";

					const placeholder = String(field.placeholder ?? "");
					let inputEl: HTMLInputElement | HTMLTextAreaElement;
					if (field.type === "textarea") {
						inputEl = wrap.createEl("textarea", {
							attr: {
								rows: "4",
								style: "width: 100%;",
								placeholder,
							},
						});
						inputEl.value = String(field.defaultValue ?? "");
					} else {
						inputEl = wrap.createEl("input", {
							attr: {
								type: "text",
								style: "width: 100%;",
								placeholder,
								value: String(field.defaultValue ?? ""),
							},
						});
						// Record the first text input (usually "title") to focus later
						if (!firstTextInputName)
							firstTextInputName = field.name;
					}
					this.inputs[field.name] = inputEl;

					if (field.description) {
						const desc = wrap.createEl("div", {
							text: String(field.description),
						});
						desc.style.fontSize = "12px";
						desc.style.color = "var(--text-muted)";
						desc.style.marginTop = "4px";
					}
				}

				// Autofocus Title (or first text input) and move caret to end
				if (firstTextInputName && this.inputs[firstTextInputName]) {
					const el = this.inputs[
						firstTextInputName
					] as HTMLInputElement;
					// Focus after a tick so it doesn't fight modal animation
					setTimeout(() => {
						try {
							el.focus();
							const v = el.value ?? "";
							el.setSelectionRange(v.length, v.length);
						} catch {
							// ignore
						}
					}, 0);
				}

				const btnRow = contentEl.createEl("div", {
					attr: { style: "display:flex; gap:8px; margin-top: 12px;" },
				});
				const okBtn = btnRow.createEl("button", {
					text: isEdit ? "Update" : "Insert",
				});
				const cancelBtn = btnRow.createEl("button", { text: "Cancel" });

				okBtn.addEventListener("click", () => {
					if (this.resolved) return;
					const values: Record<string, unknown> = {};
					let valid = true;
					for (const field of (schema.fields ??
						[]) as ParamsSchemaField[]) {
						const el = this.inputs[field.name];
						let raw = "";
						if (!el) raw = "";
						else if ((el as HTMLInputElement).value != null)
							raw = String((el as HTMLInputElement).value);
						else raw = String(el.textContent ?? "");
						values[field.name] = raw;
						if (field.required && raw.trim().length === 0) {
							new Notice(
								`"${field.label ?? field.name}" is required`
							);
							valid = false;
							break;
						}
					}
					if (!valid) return;
					this.resolved = true;
					this.close();
					resolve(values);
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
