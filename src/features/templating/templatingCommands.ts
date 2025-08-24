import { Notice, MarkdownView, Modal, App, debounce } from "obsidian";
import {
	insertTemplateAtCursor,
	isTemplateAllowedAtCursor,
} from "./templateApi";
import { presetTemplates } from "./presets";
import type { TemplateDefinition, ParamSchema } from "./types";

/**
 Decide how to get params for a template:
 - If caller provided paramsProgrammatic, use those (no prompt).
 - Else if def.hasParams === true:
    - If def.paramsSchema present => show schema form modal
    - Else => fallback to raw JSON modal
 - Else return undefined
*/
async function resolveParamsForTemplate(
	app: App,
	templateId: string,
	def: TemplateDefinition,
	paramsProgrammatic?: unknown
): Promise<unknown | undefined> {
	if (paramsProgrammatic && typeof paramsProgrammatic === "object") {
		return paramsProgrammatic; // programmatic override, no prompt
	}
	if (!def.hasParams) return undefined;

	if (def.paramsSchema && def.paramsSchema.fields?.length) {
		return await promptForSchemaParams(app, templateId, def.paramsSchema);
	}
	// Fallback to JSON if no schema provided
	return await promptForJsonParams(app, templateId);
}

/**
 Schema-based form modal
*/
function promptForSchemaParams(
	app: App,
	templateId: string,
	schema: ParamSchema
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
				const title = schema.title ?? `Parameters for ${templateId}`;
				this.titleEl.setText(title);

				if (schema.description) {
					const p = contentEl.createEl("p", {
						text: schema.description,
					});
					p.style.marginBottom = "8px";
				}

				for (const field of schema.fields) {
					const wrap = contentEl.createEl("div", {
						attr: { style: "margin-bottom: 10px;" },
					});

					const labelEl = wrap.createEl("label", {
						text: field.label + (field.required ? " *" : ""),
					});
					labelEl.style.display = "block";
					labelEl.style.fontWeight = "600";
					labelEl.style.marginBottom = "4px";

					let inputEl: HTMLInputElement | HTMLTextAreaElement;
					if (field.type === "textarea") {
						inputEl = wrap.createEl("textarea", {
							attr: {
								rows: "4",
								style: "width: 100%;",
								placeholder: field.placeholder ?? "",
							},
						});
						if (field.defaultValue)
							inputEl.value = field.defaultValue;
					} else {
						inputEl = wrap.createEl("input", {
							attr: {
								type: "text",
								style: "width: 100%;",
								placeholder: field.placeholder ?? "",
								value: field.defaultValue ?? "",
							},
						});
					}

					this.inputs[field.name] = inputEl;

					if (field.description) {
						const desc = wrap.createEl("div", {
							text: field.description,
						});
						desc.style.fontSize = "12px";
						desc.style.color = "var(--text-muted)";
						desc.style.marginTop = "4px";
					}
				}

				const btnRow = contentEl.createEl("div", {
					attr: { style: "display:flex; gap:8px; margin-top: 12px;" },
				});
				const okBtn = btnRow.createEl("button", { text: "Insert" });
				const cancelBtn = btnRow.createEl("button", { text: "Cancel" });

				okBtn.addEventListener("click", () => {
					if (this.resolved) return;
					const values: Record<string, unknown> = {};
					let valid = true;
					for (const field of schema.fields) {
						const el = this.inputs[field.name];
						const raw = (el?.value ?? "").toString();
						if (field.required && raw.trim().length === 0) {
							new Notice(`"${field.label}" is required`);
							valid = false;
							break;
						}
						values[field.name] = raw;
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

/**
 JSON fallback modal (used only when hasParams=true but no paramsSchema is defined)
*/
function promptForJsonParams(app: App, templateId: string): Promise<any> {
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
					} catch (e: any) {
						new Notice(
							`Invalid JSON: ${e?.message ?? "Parse error"}`
						);
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

function reportInsertError(err: any): void {
	const code = err?.details?.code ?? err?.code ?? "ERROR";
	const msgs: string[] | undefined =
		err?.details?.messages ?? err?.messages ?? undefined;
	const extra =
		Array.isArray(msgs) && msgs.length
			? `: ${msgs.join(" ")}`
			: err?.message
			? `: ${String(err.message)}`
			: "";
	new Notice(`Template insert failed [${code}]${extra}`);
}

/**
 Flatten presetTemplates into a list of { id, name, entry }.
*/
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

	for (const [group, groupObj] of Object.entries(
		presetTemplates as Record<string, any>
	)) {
		for (const [key, entry] of Object.entries(groupObj ?? {})) {
			if (
				entry &&
				typeof entry === "object" &&
				typeof (entry as TemplateDefinition).render === "function"
			) {
				out.push({
					id: `${group}.${key}`,
					name: makeName(`${group}.${key}`),
					def: entry as TemplateDefinition,
				});
			}
		}
	}
	return out;
}

/**
 Command Manager
 - Registers dynamic commands based on current cursor/context.
 - Clears and rebuilds on editor/cursor changes with debounce.
*/
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
			// optional: removeCommand is not in official API;
			// we simulate removal by tracking and not re-adding duplicates.
		}
	) {}

	clearCommands() {
		// Obsidian doesn't expose removeCommand for 3rd party easily.
		// We "logically" clear by resetting our ID set so re-registering
		// won't create duplicates (IDs must be unique).
		this.registeredIds.clear();
	}

	registerAllowedCommands(
		allowed: Array<{ id: string; name: string; def: TemplateDefinition }>
	) {
		for (const { id, name, def } of allowed) {
			const cmdId = `tpl-${id.replace(/\./g, "-")}`;
			if (this.registeredIds.has(cmdId)) continue;

			this.plugin.addCommand({
				id: cmdId,
				name: `Insert Template: ${name}`,
				editorCallback: async (editor, view) => {
					try {
						if (!(view instanceof MarkdownView)) return;
						const filePath = (view as any)?.file?.path ?? "";
						if (!filePath) return;

						// Resolve params (schema or JSON) if needed
						const params = await resolveParamsForTemplate(
							this.plugin.app,
							id,
							def,
							undefined
						);

						insertTemplateAtCursor(id, editor, filePath, params);
					} catch (err: any) {
						reportInsertError(err);
					}
				},
			});

			this.registeredIds.add(cmdId);
		}
	}
}

/**
 Public API: register all template commands dynamically based on context.
 - No modal/selector; only permitted commands are available in palette/slash list.
 - Future-proof: validity defers to evaluateRules (including any new rules added later).
*/
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
	registerEvent?: (evt: any) => void;
	onLayoutReady?: (cb: () => void) => void;
}): void {
	const allTemplates = enumeratePresetTemplates();
	const manager = new DynamicTemplateCommandManager(plugin);

	// Debounced refresh: re-register commands allowed in the current context
	const refresh = debounce(
		() => {
			const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
			if (!view) return;
			const editor = view.editor;
			const filePath = (view as any)?.file?.path ?? "";
			if (!filePath) return;

			const allowed: Array<{
				id: string;
				name: string;
				def: TemplateDefinition;
			}> = [];
			for (const entry of allTemplates) {
				if (isTemplateAllowedAtCursor(entry.id, editor, filePath)) {
					allowed.push(entry);
				}
			}

			manager.clearCommands();
			manager.registerAllowedCommands(allowed);
		},
		150,
		true
	);

	// Initial after layout ready
	plugin.onLayoutReady?.(() => {
		refresh();
	});

	// When active leaf (view) changes, refresh
	plugin.app.workspace.on("active-leaf-change", () => {
		refresh();
	});

	// On editor-change (content changes at view level), refresh
	// Signature: (editor: Editor, markdownView: MarkdownView) => void
	plugin.app.workspace.on("editor-change", () => {
		refresh();
	});

	// On file open (may change context), refresh
	plugin.app.workspace.on("file-open", () => {
		refresh();
	});

	// Also refresh when metadata cache changes (parents/structure may affect rules)
	plugin.app.metadataCache.on("changed", () => refresh());
}

/**
 Example: programmatic insertion with params from your own code (not the command palette).
 You can call this helper wherever you want inside your plugin code.
*/
export async function insertTemplateProgrammatically(
	app: App,
	editor: MarkdownView["editor"],
	filePath: string,
	templateId: string,
	params?: Record<string, unknown>
) {
	try {
		// Find definition for schema/hasParams decisions (not strictly required to call here,
		// but helpful if you want to optionally open the modal when params missing).
		const [group, key] = templateId.split(".");
		const def = (presetTemplates as any)?.[group]?.[key] as
			| TemplateDefinition
			| undefined;

		const finalParams =
			params ??
			(await resolveParamsForTemplate(app, templateId, def!, undefined));

		insertTemplateAtCursor(templateId, editor, filePath, finalParams);
	} catch (err: any) {
		reportInsertError(err);
	}
}
