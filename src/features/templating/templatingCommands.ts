import { Notice, MarkdownView, Modal, App, debounce } from "obsidian";
import {
	insertTemplateAtCursor,
	isTemplateAllowedAtCursor,
	renderTemplateOnly,
	inferParamsForWrapper,
	resolveModalTitleFromSchema,
} from "./templateApi";
import { presetTemplates } from "./presets";
import type {
	TemplateDefinition,
	ParamsSchema,
	ParamsSchemaField,
} from "./types";

// Helper to resolve file path from a MarkdownView without using `any`
function getFilePathFromView(view?: MarkdownView): string {
	if (!view) return "";
	const maybe = view as unknown as { file?: { path?: string } };
	return maybe.file?.path ?? "";
}

// Helper to prepare modal title/options from paramsSchema and isEdit flag
function prepareModalOptions(
	schema: ParamsSchema | undefined,
	isEdit: boolean
) {
	const title = resolveModalTitleFromSchema(schema, isEdit);
	return { title };
}

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
		// Creating a new template instance -> show 'create' title
		return await promptForSchemaParams(
			app,
			templateId,
			def.paramsSchema,
			false
		);
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
				// Use helper to determine title
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

				// Ensure safe iteration and indexing for schema fields
				// build inputs
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

					// store input
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
				const okBtn = btnRow.createEl("button", { text: "Insert" });
				const cancelBtn = btnRow.createEl("button", { text: "Cancel" });

				okBtn.addEventListener("click", () => {
					if (this.resolved) return;
					const values: Record<string, unknown> = {};
					let valid = true;
					// collect values
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

/**
 JSON fallback modal (used only when hasParams=true but no paramsSchema is defined)
*/
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

function reportInsertError(err: unknown): void {
	function asRecord(x: unknown): x is Record<string, unknown> {
		return typeof x === "object" && x !== null;
	}
	let code = "ERROR";
	let extra = "";
	if (asRecord(err)) {
		const details = err["details"] as Record<string, unknown> | undefined;
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

// Find the nearest template wrapper for a click target
function findTemplateWrapper(el: HTMLElement | null): HTMLElement | null {
	while (el) {
		if (el.hasAttribute("data-template-wrapper")) return el;
		el = el.parentElement;
	}
	return null;
}

async function onTemplateWrapperClick(
	app: App,
	wrapperEl: HTMLElement
): Promise<void> {
	const templateKey = wrapperEl.getAttribute("data-template-key") ?? "";
	if (!templateKey) return;

	// Lookup definition
	const [group, key] = templateKey.split(".");
	let def: TemplateDefinition | undefined = undefined;
	// Safe access: cast to an indexable shape to avoid string-key indexing issues
	const groupMap = presetTemplates as unknown as Record<
		string,
		Record<string, TemplateDefinition>
	>;
	if (group in groupMap) {
		def = groupMap[group]?.[key] as TemplateDefinition | undefined;
	}
	if (!def) return;

	// Only parameterized templates open a modal
	if (!def.hasParams) return;

	// Prefill values from DOM if we can
	const prefill = inferParamsForWrapper(templateKey, wrapperEl) ?? {};

	// If no schema provided, fall back to JSON modal; else use schema modal
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
		// Editing an existing template instance -> show 'Edit' title
		params = await promptForSchemaParams(app, templateKey, schema, true);
	} else {
		// JSON path: seed with prefill
		const jsonParams = JSON.stringify(prefill ?? {}, null, 2);
		params = await new Promise((resolve) => {
			const modal = new (class extends Modal {
				private textarea!: HTMLTextAreaElement;
				private resolved = false;

				onOpen(): void {
					this.titleEl.setText(`Params for ${templateKey}`);
					const { contentEl } = this;
					contentEl.createEl("p", {
						text: "Edit template params as JSON.",
					});
					this.textarea = contentEl.createEl("textarea", {
						attr: { rows: "10", style: "width: 100%;" },
					});
					this.textarea.value = jsonParams;

					const btnRow = contentEl.createEl("div", {
						attr: {
							style: "display:flex; gap:8px; margin-top: 12px;",
						},
					});
					const okBtn = btnRow.createEl("button", { text: "Apply" });
					const cancelBtn = btnRow.createEl("button", {
						text: "Cancel",
					});
					okBtn.addEventListener("click", () => {
						if (this.resolved) return;
						this.resolved = true;
						try {
							const parsed = JSON.parse(this.textarea.value);
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

	if (!params) return;

	// Re-render the template HTML with new params and replace wrapper element wholesale
	try {
		const newHtml = renderTemplateOnly(templateKey, params);
		// Replace the entire wrapper element (outerHTML) so a fresh instanceId is used
		wrapperEl.outerHTML = newHtml;
	} catch (e) {
		const msg = (e as Error)?.message ?? String(e);
		new Notice(`Failed to update template: ${msg}`);
	}
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
						const filePath = getFilePathFromView(view);
						if (!filePath) return;

						const [group, key] = id.split(".");
						let defRef: TemplateDefinition | undefined = undefined;
						const groupMap = presetTemplates as unknown as Record<
							string,
							Record<string, TemplateDefinition>
						>;
						if (group in groupMap) {
							defRef = groupMap[group]?.[key] as
								| TemplateDefinition
								| undefined;
						}
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

function resolveContentRoot(view: MarkdownView): HTMLElement | null {
	// Prefer the actual CodeMirror 6 content surface
	const cmContent =
		(view as any)?.editor?.cm?.contentDOM ||
		view.containerEl.querySelector(".cm-content");
	return (cmContent as HTMLElement) ?? null;
}

/**
 Public API: register all template commands dynamically based on context.
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
	registerEvent?: (evt: unknown) => void;
	onLayoutReady?: (cb: () => void) => void;
}): void {
	// Do NOT cache allTemplates permanently if presets may change; recompute inside refresh.
	const manager = new DynamicTemplateCommandManager(plugin);

	// Debounced refresh: re-register commands allowed in the current context
	const refresh = debounce(
		() => {
			const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
			if (!view) return;
			const editor = view.editor;
			const filePath = getFilePathFromView(view);
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
					if (isTemplateAllowedAtCursor(entry.id, editor, filePath))
						allowed.push(entry);
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

	// Click-to-edit: delegate on the CodeMirror content area specifically
	const wireClickHandler = () => {
		const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;

		// Resolve the content root reliably
		const contentRoot = resolveContentRoot(view) as any;
		// Fallback to containerEl if content root not present yet
		const targetEl: HTMLElement =
			(contentRoot as HTMLElement) ?? (view as any).containerEl;
		if (!targetEl) return;

		// Avoid multiple listeners
		const MARKER = "__tplClickWired";
		if ((targetEl as any)[MARKER]) return;
		(targetEl as any)[MARKER] = true;

		// Capture-phase to intercept before default link/navigation handlers
		targetEl.addEventListener(
			"click",
			async (evt: MouseEvent) => {
				const target = evt.target as HTMLElement | null;
				if (!target) return;

				const wrapper = findTemplateWrapper(target);
				if (!wrapper) return;

				evt.preventDefault();
				evt.stopPropagation();

				try {
					await onTemplateWrapperClick(plugin.app, wrapper);
				} catch {
					// ignore
				}
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

/**
 Programmatic API
*/
export async function insertTemplateProgrammatically(
	app: App,
	editor: MarkdownView["editor"],
	filePath: string,
	templateId: string,
	params?: Record<string, unknown>
) {
	try {
		const [group, key] = templateId.split(".");
		let def: TemplateDefinition | undefined = undefined;
		// Safe access via a cast to avoid TS index signature errors
		const groupMap = presetTemplates as unknown as Record<
			string,
			Record<string, TemplateDefinition>
		>;
		if (group in groupMap) {
			def = groupMap[group]?.[key] as TemplateDefinition | undefined;
		}
		if (!def) throw new Error(`Template not found: ${templateId}`);
		const finalParams =
			params ??
			(await resolveParamsForTemplate(app, templateId, def, undefined));
		insertTemplateAtCursor(templateId, editor, filePath, finalParams);
	} catch (err) {
		reportInsertError(err);
	}
}
