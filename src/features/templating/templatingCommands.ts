import { Notice, MarkdownView, Modal, App, debounce } from "obsidian";
import {
	insertTemplateAtCursor,
	isTemplateAllowedAtCursor,
	renderTemplateOnly,
	inferParamsForWrapper,
	resolveModalTitleFromSchema,
	getTemplateWrapperOnLine,
} from "./templateApi";
import { presetTemplates } from "./presets";
import { getCursorContext } from "./cursorContext";
import type {
	TemplateDefinition,
	ParamsSchema,
	ParamsSchemaField,
} from "./types";

// Helper to choose modal title
function prepareModalOptions(
	schema: ParamsSchema | undefined,
	isEdit: boolean
) {
	const title = resolveModalTitleFromSchema(schema, isEdit);
	return { title };
}

// Prompt for schema params modal
function promptForSchemaParams(
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
				const opts = prepareModalOptions(schema, isEdit);
				const title =
					opts.title ||
					schema.title ||
					`Parameters for ${templateId}`;
				this.titleEl.setText(title);

				if (schema.description) {
					const p = contentEl.createEl("p", {
						text: schema.description,
					});
					p.style.marginBottom = "8px";
				}

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

					let inputEl: HTMLInputElement | HTMLTextAreaElement;
					const placeholder = String(field.placeholder ?? "");
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
					}

					(this.inputs as Record<string, unknown>)[field.name] =
						inputEl;

					if (field.description) {
						const desc = wrap.createEl("div", {
							text: String(field.description),
						});
						desc.style.fontSize = "12px";
						desc.style.color = "var(--text-muted)";
						desc.style.marginTop = "4px";
					}
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
						const el = (this.inputs as Record<string, unknown>)[
							field.name
						] as HTMLInputElement | HTMLTextAreaElement | undefined;
						let raw = "";
						if (!el) raw = "";
						else if ((el as HTMLInputElement).value != null)
							raw = String((el as HTMLInputElement).value);
						else raw = String(el.textContent ?? "");
						(values as Record<string, unknown>)[field.name] = raw;
						if (field.required && raw.trim().length === 0) {
							new Notice(`"${field.label}" is required`);
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

function promptForJsonParams(
	app: App,
	templateId: string
): Promise<unknown | undefined> {
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
					attr: { rows: "8", style: "width: 100%;" },
				});

				const btnRow = contentEl.createEl("div", {
					attr: { style: "display:flex; gap:8px; margin-top: 12px;" },
				});
				const okBtn = btnRow.createEl("button", { text: "Insert" });
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
						const parsed = JSON.parse(v);
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

async function resolveParamsForTemplate(
	app: App,
	templateId: string,
	def: TemplateDefinition,
	paramsProgrammatic?: unknown
): Promise<unknown | undefined> {
	if (paramsProgrammatic && typeof paramsProgrammatic === "object")
		return paramsProgrammatic;
	if (!def.hasParams) return undefined;
	if (def.paramsSchema && def.paramsSchema.fields?.length)
		return await promptForSchemaParams(
			app,
			templateId,
			def.paramsSchema,
			false
		);
	return await promptForJsonParams(app, templateId);
}

function reportInsertError(err: unknown): void {
	let code = "ERROR";
	let extra = "";
	if (typeof err === "object" && err !== null) {
		const details = (err as Record<string, unknown>)["details"] as
			| Record<string, unknown>
			| undefined;
		const msgs = (details?.["messages"] ??
			(err as Record<string, unknown>)["messages"]) as
			| string[]
			| undefined;
		code =
			(details?.["code"] as string) ??
			((err as Record<string, unknown>)["code"] as string) ??
			"ERROR";
		if (Array.isArray(msgs) && msgs.length) extra = `: ${msgs.join(" ")}`;
		else if ((err as Record<string, unknown>)["message"])
			extra = `: ${String((err as Record<string, unknown>)["message"])}`;
	}
	new Notice(`Template insert failed [${code}]${extra}`);
}

function enumeratePresetTemplates(): Array<{
	id: string;
	name: string;
	def: TemplateDefinition;
}> {
	const out: Array<{ id: string; name: string; def: TemplateDefinition }> =
		[];
	const titleCase = (s: string) =>
		s.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/[-_]/g, " ");
	const makeName = (id: string) =>
		id
			.split(".")
			.map((seg) => titleCase(seg))
			.join(" / ");
	for (const [group, groupObj] of Object.entries(presetTemplates)) {
		if (group === "members") continue;
		for (const [key, entry] of Object.entries(groupObj ?? {})) {
			if (
				entry &&
				typeof entry === "object" &&
				typeof (entry as TemplateDefinition).render === "function"
			) {
				const def = entry as TemplateDefinition;
				if (def.hiddenFromDynamicCommands) continue;
				out.push({
					id: `${group}.${key}`,
					name: makeName(`${group}.${key}`),
					def,
				});
			}
		}
	}
	return out;
}

class DynamicTemplateCommandManager {
	private registeredIds = new Set<string>();
	constructor(
		private plugin: {
			app: App;
			addCommand: (cmd: {
				id: string;
				name: string;
				editorCallback: (
					editor: MarkdownView["editor"],
					view: MarkdownView
				) => void;
			}) => void;
		}
	) {}
	clearCommands() {
		this.registeredIds.clear();
	}
	registerAllowedCommands(
		allowed: Array<{ id: string; name: string; def: TemplateDefinition }>
	) {
		for (const { id, name, def } of allowed) {
			if (id.startsWith("members.")) continue;
			if (def.hiddenFromDynamicCommands) continue;
			const cmdId = `tpl-${id.replace(/\./g, "-")}`;
			if (this.registeredIds.has(cmdId)) continue;
			this.plugin.addCommand({
				id: cmdId,
				name: `Insert Template: ${name}`,
				editorCallback: async (editor, view) => {
					try {
						if (!(view instanceof MarkdownView)) return;
						const ctx = await getCursorContext(
							this.plugin.app,
							view,
							editor
						);
						const filePath = ctx.filePath;
						if (!filePath) return;
						const [group, key] = id.split(".");
						const groupMap = presetTemplates as unknown as Record<
							string,
							Record<string, TemplateDefinition>
						>;
						const defRef = groupMap[group]?.[key] as
							| TemplateDefinition
							| undefined;
						if (!defRef) return;
						const params = await resolveParamsForTemplate(
							this.plugin.app,
							id,
							defRef,
							undefined
						);
						insertTemplateAtCursor(id, editor, filePath, params);
					} catch (err) {
						reportInsertError(err);
					}
				},
			});
			this.registeredIds.add(cmdId);
		}
	}
}

export function registerTemplatingCommands(plugin: {
	app: App;
	addCommand: (cmd: {
		id: string;
		name: string;
		editorCallback: (
			editor: MarkdownView["editor"],
			view: MarkdownView
		) => void;
	}) => void;
	registerEvent?: (evt: unknown) => void;
	onLayoutReady?: (cb: () => void) => void;
}): void {
	const manager = new DynamicTemplateCommandManager(plugin);
	const refresh = debounce(
		async () => {
			const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
			if (!view) return;
			const editor = view.editor;
			const ctx = await getCursorContext(plugin.app, view, editor);
			const filePath = ctx.filePath;
			if (!filePath) return;
			const pool = enumeratePresetTemplates();
			const allowed: Array<{
				id: string;
				name: string;
				def: TemplateDefinition;
			}> = [];
			for (const entry of pool) {
				if (entry.id.startsWith("members.")) continue;
				try {
					if (isTemplateAllowedAtCursor(entry.id, editor, filePath)) {
						allowed.push(entry);
					}
				} catch (e) {
					console.warn(
						"isTemplateAllowedAtCursor failed for",
						entry.id,
						e
					);
				}
			}
			manager.clearCommands();
			manager.registerAllowedCommands(allowed);
		},
		150,
		true
	);

	const wireClickHandler = () => {
		const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;
		const cmHolder = view as unknown as {
			editor?: { cm?: { contentDOM?: HTMLElement } };
		};
		const cmContent = cmHolder.editor?.cm?.contentDOM;
		const contentRoot = (cmContent ??
			view.containerEl.querySelector(
				".cm-content"
			)) as HTMLElement | null;
		const targetEl: HTMLElement = contentRoot ?? view.containerEl;
		if (!targetEl) return;
		const MARKER = "__tplClickWired";
		const markerObj = targetEl as unknown as Record<string, unknown>;
		if (markerObj[MARKER]) return;
		markerObj[MARKER] = true;

		targetEl.addEventListener(
			"click",
			async (evt: MouseEvent) => {
				const target = evt.target as HTMLElement | null;
				if (!target) return;
				// find wrapper element
				let el: HTMLElement | null = target;
				while (el) {
					if (el.hasAttribute("data-template-wrapper")) break;
					el = el.parentElement;
				}
				if (!el) return;
				evt.preventDefault();
				evt.stopPropagation();
				try {
					// call click-to-edit
					const templateKey =
						el.getAttribute("data-template-key") ?? "";
					if (!templateKey) return;
					const [group, key] = templateKey.split(".");
					const groupMap = presetTemplates as unknown as Record<
						string,
						Record<string, TemplateDefinition>
					>;
					const def = groupMap[group]?.[key] as
						| TemplateDefinition
						| undefined;
					if (!def) return;
					if (!def.hasParams) return;

					const prefill =
						inferParamsForWrapper(templateKey, el) ?? {};
					let params: Record<string, unknown> | undefined;
					if (def.paramsSchema && def.paramsSchema.fields?.length) {
						const schema = {
							...def.paramsSchema,
							fields: def.paramsSchema.fields.map((f) => ({
								...f,
								defaultValue:
									prefill[f.name] != null
										? String(prefill[f.name] ?? "")
										: f.defaultValue,
							})),
						};
						params = await promptForSchemaParams(
							plugin.app,
							templateKey,
							schema,
							true
						);
					} else {
						// JSON path
						const jsonParams = JSON.stringify(
							prefill ?? {},
							null,
							2
						);
						params = await new Promise((resolve) => {
							const modal = new (class extends Modal {
								private textarea!: HTMLTextAreaElement;
								private resolved = false;
								onOpen(): void {
									this.titleEl.setText(
										`Params for ${templateKey}`
									);
									const { contentEl } = this;
									contentEl.createEl("p", {
										text: "Edit template params as JSON.",
									});
									this.textarea = contentEl.createEl(
										"textarea",
										{
											attr: {
												rows: "10",
												style: "width:100%;",
											},
										}
									);
									this.textarea.value = jsonParams;
									const btnRow = contentEl.createEl("div", {
										attr: {
											style: "display:flex; gap:8px; margin-top: 12px;",
										},
									});
									const okBtn = btnRow.createEl("button", {
										text: "Apply",
									});
									const cancelBtn = btnRow.createEl(
										"button",
										{ text: "Cancel" }
									);
									okBtn.addEventListener("click", () => {
										if (this.resolved) return;
										this.resolved = true;
										try {
											const parsed = JSON.parse(
												this.textarea.value
											);
											this.close();
											resolve(parsed);
										} catch (e) {
											new Notice("Invalid JSON");
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
							})(plugin.app);
							modal.open();
						});
					}

					if (!params) return;
					try {
						const newHtml = renderTemplateOnly(templateKey, params);
						el.outerHTML = newHtml;
					} catch (e) {
						new Notice(
							`Failed to update template: ${String(
								(e as Error)?.message ?? e
							)}`
						);
					}
				} catch (err) {
					reportInsertError(err as unknown);
				}
			},
			true
		);

		// Enter auto-open handler
		targetEl.addEventListener(
			"keydown",
			async (evt: KeyboardEvent) => {
				if (evt.key !== "Enter") return;
				setTimeout(async () => {
					const view =
						plugin.app.workspace.getActiveViewOfType(MarkdownView);
					if (!view) return;
					const editor = view.editor;
					const ctx = await getCursorContext(
						plugin.app,
						view,
						editor
					);
					const prevLine = ctx.lineNumber - 1;
					if (prevLine < 0) return;

					const wrapperInfo = getTemplateWrapperOnLine(
						view,
						prevLine
					);
					if (!wrapperInfo || !wrapperInfo.templateKey) return;
					if (wrapperInfo.orderTag !== "artifact-item-type") return;
					// Only trigger if the new line is a blank task
					if (!/^s*[-*+]s*[.?]s*$/.test(ctx.lineText ?? ""))
						return;
					const [g, k] = (wrapperInfo.templateKey ?? "").split(".");
					const groupMap = presetTemplates as unknown as Record<
						string,
						Record<string, TemplateDefinition>
					>;
					const def = groupMap[g]?.[k] as
						| TemplateDefinition
						| undefined;
					if (!def || !def.hasParams) return;

					const schema = def.paramsSchema
						? {
								...def.paramsSchema,
								fields:
									def.paramsSchema.fields?.map((f) => ({
										...f,
									})) ?? [],
						  }
						: undefined;
					if (!schema) return;
					const params = await promptForSchemaParams(
						plugin.app,
						wrapperInfo.templateKey,
						schema,
						false
					);
					if (!params) return;
					insertTemplateAtCursor(
						wrapperInfo.templateKey,
						editor,
						ctx.filePath,
						params as Record<string, unknown> | undefined
					);
				}, 50);
			},
			true
		);
	};

	plugin.onLayoutReady?.(() => {
		wireClickHandler();
		refresh();
	});
	plugin.app.workspace.on("active-leaf-change", () => {
		wireClickHandler();
		refresh();
	});
	plugin.app.workspace.on("editor-change", () => {
		wireClickHandler();
		refresh();
	});
	plugin.app.workspace.on("file-open", () => {
		wireClickHandler();
		refresh();
	});
	plugin.app.metadataCache.on("changed", () => {
		wireClickHandler();
		refresh();
	});
}

export async function insertTemplateProgrammatically(
	app: App,
	editor: MarkdownView["editor"],
	filePath: string,
	templateId: string,
	params?: Record<string, unknown>
) {
	try {
		const [group, key] = templateId.split(".");
		const groupMap = presetTemplates as unknown as Record<
			string,
			Record<string, TemplateDefinition>
		>;
		const def = groupMap[group]?.[key] as TemplateDefinition | undefined;
		if (!def) throw new Error(`Template not found: ${templateId}`);
		const finalParams =
			params ??
			(await resolveParamsForTemplate(app, templateId, def, undefined));
		insertTemplateAtCursor(templateId, editor, filePath, finalParams);
	} catch (err) {
		reportInsertError(err as unknown);
	}
}
