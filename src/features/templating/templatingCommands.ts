import { Notice, MarkdownView, Modal, App } from "obsidian";
import { insertTemplate } from "./templateApi";
import { presetTemplates } from "./presets";
import type { TemplateDefinition } from "./types";

/**
 - We support two shapes in presetTemplates:
   1) Function entries that return string (non-parameterized);
   2) TemplateDefinition objects with render(params) (parameterized).
 - This utility normalizes either shape into { hasParams, invoke }.
*/
function normalizeTemplateEntry(entry: unknown): {
	hasParams: boolean;
	invoke: (ctx: {
		app: App;
		editor: MarkdownView["editor"];
		filePath: string;
		templateId: string;
	}) => Promise<void>;
} | null {
	// TemplateDefinition: must have render function
	if (
		entry &&
		typeof entry === "object" &&
		typeof (entry as TemplateDefinition).render === "function"
	) {
		return {
			hasParams: true,
			invoke: async ({ app, editor, filePath, templateId }) => {
				// Prompt for params (JSON) via a lightweight modal.
				const params = await promptForJsonParams(app, templateId);
				try {
					const ctx = buildCtx(editor, filePath);
					const rendered = insertTemplate(templateId, ctx, params);
					replaceCurrentLine(editor, rendered);
				} catch (err: any) {
					reportInsertError(err);
				}
			},
		};
	}

	// Function returning string (non-parameterized)
	if (typeof entry === "function") {
		return {
			hasParams: false,
			invoke: async ({ editor, filePath, templateId }) => {
				try {
					const ctx = buildCtx(editor, filePath);
					const rendered = insertTemplate(templateId, ctx);
					replaceCurrentLine(editor, rendered);
				} catch (err: any) {
					reportInsertError(err);
				}
			},
		};
	}

	return null;
}

function buildCtx(editor: MarkdownView["editor"], filePath: string) {
	const cursor = editor.getCursor();
	const lineText = editor.getLine(cursor.line);
	const content = editor.getValue();
	return {
		line: lineText,
		file: content,
		path: filePath,
		editor,
	};
}

function replaceCurrentLine(
	editor: MarkdownView["editor"],
	rendered: string
): void {
	const cursor = editor.getCursor();
	const lineText = editor.getLine(cursor.line);
	const from = { line: cursor.line, ch: 0 };
	const to = { line: cursor.line, ch: lineText.length };
	const next = lineText.length === 0 ? rendered : `${lineText} ${rendered}`;
	editor.replaceRange(next, from, to);
}

/**
 Lightweight JSON params modal.
 - Shows an empty textarea by default.
 - If user cancels, we return undefined (callers may fall back).
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
					text: 'Enter template params as JSON (optional). Example: {"persona":"admin"}',
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
						// do not resolve; keep modal open
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
	// Try to surface our TemplateInsertError details cleanly
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
 - id is the dot path (e.g., "agile.userStory")
 - name is derived from templateMeta.json label if you later wire it in, else TitleCased id
   For now, we TitleCase the id segments.
*/
function enumeratePresetTemplates(): Array<{
	id: string;
	name: string;
	entry: unknown;
}> {
	const out: Array<{ id: string; name: string; entry: unknown }> = [];
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
			out.push({
				id: `${group}.${key}`,
				name: makeName(`${group}.${key}`),
				entry,
			});
		}
	}
	return out;
}

/**
 Public API: register all template commands.
 - Registers one Obsidian command per template.
 - Parameterized templates prompt for JSON params; non-parameterized insert immediately.
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
}): void {
	const list = enumeratePresetTemplates();

	for (const { id, name, entry } of list) {
		const normalized = normalizeTemplateEntry(entry);
		if (!normalized) continue;

		plugin.addCommand({
			id: `tpl-${id.replace(/\./g, "-")}`,
			name: `Insert Template: ${name}`,
			editorCallback: async (editor, view) => {
				try {
					if (!(view instanceof MarkdownView)) return;
					const filePath = (view as any)?.file?.path ?? "";
					if (!filePath) return;

					await normalized.invoke({
						app: plugin.app,
						editor,
						filePath,
						templateId: id,
					});
				} catch (err: any) {
					reportInsertError(err);
				}
			},
		});
	}
}
