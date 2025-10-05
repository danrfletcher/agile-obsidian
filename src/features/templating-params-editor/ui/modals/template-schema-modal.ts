import { App, Modal, Notice } from "obsidian";
import type { ParamsSchema, ParamsSchemaField } from "@features/templating-engine";
import { resolveModalTitleFromSchema } from "../../app/params-editor-service";
import { escapeHtml } from "@utils";

/**
 Helpers and types for blockSelect
*/

type FileCandidate = {
	kind: "file";
	filePath: string; // full path
	basename: string; // file name without extension
	display: string; // for list rendering
	matchText: string; // for searching
};

type BlockCandidate = {
	kind: "block";
	filePath: string;
	line: number; // 0-based
	text: string; // line text (trimmed for display/search)
	blockId?: string; // if detected on the line
	display: string; // "text — path"
	matchText: string; // for searching (text + path)
};

type VaultIndex = {
	files: FileCandidate[];
	blocks: BlockCandidate[];
	builtAt: number;
};

function filenameFromPath(filePath: string): string {
	const name = (filePath.split("/").pop() || filePath).trim();
	return name.toLowerCase().endsWith(".md") ? name.slice(0, -3) : name;
}

// Module-scope cache (built on first use)
let vaultIndexPromise: Promise<VaultIndex> | null = null;

function detectBlockIdInLine(line: string): string | undefined {
	// Detect a trailing ^id or anywhere with whitespace boundary near end
	// Common convention: "... ^block-id"
	const m =
		/(?:^|\s)\^([a-zA-Z0-9-]{3,})\s*$/.exec(line) ||
		/(?:^|\s)\^([a-zA-Z0-9-]{3,})\b/.exec(line);
	return m ? m[1] : undefined;
}

function toDisplayPath(filePath: string): string {
	// Leave as-is (full path). Adjust if you prefer basename.
	return filePath;
}

function makeFileCandidate(file: any): FileCandidate {
	const filePath = String(file.path ?? "");
	const basename = String(file.basename ?? filePath);
	return {
		kind: "file",
		filePath,
		basename,
		display: basename,
		matchText: `${basename} ${filePath}`.toLowerCase(),
	};
}

function makeBlockCandidate(
	filePath: string,
	line: number,
	raw: string
): BlockCandidate {
	const text = raw.trim();
	const bid = detectBlockIdInLine(raw);
	const displayText = text.length > 120 ? text.slice(0, 117) + "…" : text;
	const pathDisp = toDisplayPath(filePath);
	return {
		kind: "block",
		filePath,
		line,
		text,
		blockId: bid,
		display: `${displayText} — ${pathDisp}`,
		matchText: `${text} ${pathDisp}`.toLowerCase(),
	};
}

async function buildVaultIndex(app: App): Promise<VaultIndex> {
	const files = (app.vault as any).getMarkdownFiles?.() ?? [];
	const fileCandidates: FileCandidate[] = files.map(makeFileCandidate);

	const blocks: BlockCandidate[] = [];
	// Read files sequentially to avoid hammering I/O; can be optimized if needed
	for (const f of files) {
		try {
			const content: string = await (app.vault as any).read(f);
			const lines = content.split(/\r?\n/);
			for (let i = 0; i < lines.length; i++) {
				const raw = lines[i];
				if (!raw || !raw.trim()) continue;
				// Treat every non-empty line as a potential linkable block
				blocks.push(makeBlockCandidate(String(f.path), i, raw));
			}
		} catch {
			// Best effort; skip unreadable files
		}
	}

	return {
		files: fileCandidates,
		blocks,
		builtAt: Date.now(),
	};
}

function ensureIndex(app: App): Promise<VaultIndex> {
	if (!vaultIndexPromise) {
		vaultIndexPromise = buildVaultIndex(app);
	}
	return vaultIndexPromise;
}

function generateBlockId(): string {
	// 8-char base36 id; adjust length/policy as needed
	return Math.random().toString(36).slice(2, 10);
}

async function ensureBlockIdOnLine(
	app: App,
	filePath: string,
	lineIndex: number
): Promise<string> {
	const abstractFile: any = (app.vault as any).getAbstractFileByPath(
		filePath
	);
	if (!abstractFile) {
		throw new Error(`File not found: ${filePath}`);
	}
	const content: string = await (app.vault as any).read(abstractFile);
	const lines = content.split(/\r?\n/);
	if (lineIndex < 0 || lineIndex >= lines.length) {
		throw new Error(`Invalid line index ${lineIndex} for ${filePath}`);
	}
	let line = lines[lineIndex];

	// If already has a block id, return it
	const existing = detectBlockIdInLine(line);
	if (existing) return existing;

	// Generate a new block id and append to the end of the line with a separating space
	let newId = generateBlockId();
	// Avoid pathological collisions within same file
	// (very unlikely, but we can ensure uniqueness by scanning lines for ^newId)
	const isIdInFile = (id: string) =>
		lines.some((ln) => new RegExp(`(?:^|\\s)\\^${id}(?:\\s|$)`).test(ln));
	let attempts = 0;
	while (isIdInFile(newId) && attempts < 5) {
		newId = generateBlockId();
		attempts++;
	}

	// Append at end, keeping trailing spaces clean
	line = line.replace(/\s+$/, "");
	lines[lineIndex] = `${line} ^${newId}`;

	const nextContent = lines.join("\n");
	await (app.vault as any).modify(abstractFile, nextContent);

	return newId;
}

function createSuggestionList(container: HTMLElement): HTMLUListElement {
	const ul = container.createEl("ul");
	ul.style.position = "absolute";
	ul.style.left = "0";
	ul.style.right = "0";
	ul.style.top = "100%";
	ul.style.zIndex = "99999";
	ul.style.maxHeight = "240px";
	ul.style.overflowY = "auto";
	ul.style.margin = "4px 0 0 0";
	ul.style.padding = "6px";
	ul.style.listStyle = "none";
	ul.style.background = "var(--background-primary)";
	ul.style.border = "1px solid var(--background-modifier-border)";
	ul.style.borderRadius = "6px";
	ul.style.boxShadow = "var(--shadow-s)";
	ul.style.display = "none";
	return ul;
}

function clearChildren(el: HTMLElement) {
	while (el.firstChild) el.removeChild(el.firstChild);
}

function normalizeQuery(q: string): string {
	return q.trim().toLowerCase();
}

type SuggestionItem = FileCandidate | BlockCandidate;

function filterSuggestions(
	index: VaultIndex,
	rawQuery: string,
	limit = 50
): SuggestionItem[] {
	const q = normalizeQuery(rawQuery);
	if (!q) return [];

	// If user types something like "<fileQuery>^<blockQuery>" focus on blocks in matching files
	const hatIdx = q.indexOf("^");
	if (hatIdx >= 0) {
		const fileQ = q.slice(0, hatIdx).trim();
		const blockQ = q.slice(hatIdx + 1).trim();

		// Filter blocks by file first, then block text
		const inFiles =
			fileQ.length > 0
				? index.files
						.filter(
							(f) =>
								f.matchText.includes(fileQ) ||
								f.filePath.toLowerCase().includes(fileQ)
						)
						.map((f) => f.filePath.toLowerCase())
				: null;

		const candidates = index.blocks.filter((b) => {
			const inFile =
				!inFiles || inFiles.includes(b.filePath.toLowerCase()); // if no fileQ, accept all files
			const blockOk =
				!blockQ ||
				b.matchText.includes(blockQ) ||
				(b.blockId ? b.blockId.toLowerCase().includes(blockQ) : false);
			return inFile && blockOk;
		});

		return candidates.slice(0, limit);
	}

	// Global search across both files and blocks
	const files = index.files.filter(
		(f) =>
			f.matchText.includes(q) ||
			f.filePath.toLowerCase().includes(q) ||
			f.basename.toLowerCase().includes(q)
	);
	const blocks = index.blocks.filter(
		(b) =>
			b.matchText.includes(q) ||
			(b.blockId ? b.blockId.toLowerCase().includes(q) : false)
	);

	// Interleave some files for convenience, then blocks
	const out: SuggestionItem[] = [];
	for (let i = 0; i < Math.min(files.length, 10); i++) out.push(files[i]);
	for (let i = 0; i < blocks.length && out.length < limit; i++)
		out.push(blocks[i]);
	return out.slice(0, limit);
}

/**
 * Helpers for rendering block previews with HTML and minimal safety.
 */

// Basic test if a string likely contains HTML tags
function looksLikeHtml(s: string): boolean {
	return /<\/?[a-z][\s\S]*>/i.test(s);
}

// Minimal sanitizer: remove script/style tags, inline event handlers, and javascript: URIs
function sanitizeHtml(raw: string): string {
	let s = raw;
	// Remove <script> and <style> blocks
	s = s.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
	s = s.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "");
	// Strip inline event handlers like onclick="..."
	s = s.replace(/\s+on\w+\s*=\s*"(?:[^"]*)"/gi, "");
	s = s.replace(/\s+on\w+\s*=\s*'(?:[^']*)'/gi, "");
	// Strip javascript: URIs in href/src/action
	s = s.replace(/\s+(href|src|action)\s*=\s*"(?:\s*javascript:[^"]*)"/gi, "");
	s = s.replace(/\s+(href|src|action)\s*=\s*'(?:\s*javascript:[^']*)'/gi, "");
	return s;
}

// Parse task/list prefix and return HTML for the marker + remaining content
function splitListOrTaskPrefix(s: string): {
	leadingHTML: string;
	content: string;
} {
	const task = /^\s*-\s+\[([^\]]*)\]\s*(.*)$/s.exec(s);
	if (task) {
		const inside = task[1] ?? "";
		const content = task[2] ?? "";
		const checked = /x/i.test(inside);
		const leading = `<input type="checkbox" ${
			checked ? "checked" : ""
		} disabled style="pointer-events:none;margin-right:6px;vertical-align:middle;" />`;
		return { leadingHTML: leading, content };
	}
	const list = /^\s*-\s+(.*)$/s.exec(s);
	if (list) {
		const content = list[1] ?? "";
		const leading = `<span style="display:inline-block;width:0.8em;text-align:center;">•</span>&nbsp;`;
		return { leadingHTML: leading, content };
	}
	return { leadingHTML: "", content: s };
}

function renderBlockLinePreview(item: BlockCandidate): string {
	const { leadingHTML, content } = splitListOrTaskPrefix(item.text);
	const contentHtml = looksLikeHtml(content)
		? sanitizeHtml(content)
		: escapeHtml(content);
	const pathHtml = escapeHtml(toDisplayPath(item.filePath));
	return `🔗 ${leadingHTML}${contentHtml}<span style="color: var(--text-muted);"> — ${pathHtml}</span>`;
}

function renderSuggestionItem(
	li: HTMLLIElement,
	item: SuggestionItem,
	highlight = false
) {
	li.style.display = "block";
	li.style.padding = "6px 8px";
	li.style.cursor = "pointer";
	li.style.borderRadius = "4px";
	li.style.whiteSpace = "nowrap";
	li.style.overflow = "hidden";
	li.style.textOverflow = "ellipsis";
	li.style.background = highlight
		? "var(--background-modifier-hover)"
		: "transparent";
	li.setAttr("data-kind", item.kind);

	if (item.kind === "file") {
		// Keep file items simple and safe
		li.innerHTML = `📄 ${escapeHtml(item.display)}`;
		li.title = item.filePath;
	} else {
		// Render block line with HTML if present; keep list/task markers intact
		li.innerHTML = renderBlockLinePreview(item);
		li.title = `${item.filePath}:${item.line + 1}`;
	}
}

function attachBlockSelectInput(
	app: App,
	wrap: HTMLElement,
	field: ParamsSchemaField
): HTMLInputElement {
	// Container styling so suggestions can be positioned
	wrap.style.position = "relative";

	const inputEl = wrap.createEl("input", {
		attr: {
			type: "text",
			style: "width: 100%;",
			placeholder: String(field.placeholder ?? "Start typing…"),
			value: String(field.defaultValue ?? ""),
		},
	});

	// Status text (e.g., "Indexing vault…")
	const statusEl = wrap.createEl("div");
	statusEl.style.fontSize = "12px";
	statusEl.style.color = "var(--text-muted)";
	statusEl.style.marginTop = "4px";
	statusEl.style.display = "none";

	const ul = createSuggestionList(wrap);
	let suggestions: SuggestionItem[] = [];
	let highlightIndex = -1;
	let idx: VaultIndex | null = null;
	let indexing = false;

	const show = () => {
		if (suggestions.length === 0) {
			ul.style.display = "none";
		} else {
			ul.style.display = "block";
		}
	};
	const hide = () => {
		ul.style.display = "none";
		highlightIndex = -1;
	};

	function renderSuggestions() {
		clearChildren(ul);
		suggestions.forEach((s, i) => {
			const li = ul.createEl("li");
			renderSuggestionItem(li, s, i === highlightIndex);
			li.addEventListener("mouseenter", () => {
				highlightIndex = i;
				// rerender highlighting
				Array.from(ul.children).forEach((child, j) => {
					(child as HTMLElement).style.background =
						j === highlightIndex
							? "var(--background-modifier-hover)"
							: "transparent";
				});
			});
			li.addEventListener("mouseleave", () => {
				// do not reset highlight here; user can move cursor out briefly
			});
			li.addEventListener("mousedown", async (e) => {
				e.preventDefault();
				e.stopPropagation();
				await handleSelect(s);
			});
		});
		show();
	}

	async function handleSelect(item: SuggestionItem) {
		if (item.kind === "file") {
			// Prefill with "basename#^"
			inputEl.value = `${filenameFromPath(item.filePath)}#^`;
			inputEl.focus();
			updateSuggestions();
			return;
		}
		// Block selected: ensure it has an id
		try {
			const id =
				item.blockId ??
				(await ensureBlockIdOnLine(app, item.filePath, item.line));
			// Use "basename#^id" (no .md)
			inputEl.value = `${filenameFromPath(item.filePath)}#^${id}`;
			hide();
		} catch (e) {
			new Notice(
				`Failed to set block id: ${String((e as Error)?.message ?? e)}`
			);
		}
	}

	async function ensureIndexReady() {
		if (idx || indexing) return;
		indexing = true;
		statusEl.style.display = "block";
		statusEl.textContent = "Indexing vault…";
		try {
			idx = await ensureIndex(app);
		} catch (e) {
			new Notice(
				`Failed to index vault: ${String((e as Error)?.message ?? e)}`
			);
		} finally {
			indexing = false;
			statusEl.style.display = "none";
		}
	}

	function updateSuggestions() {
		if (!idx) {
			hide();
			return;
		}
		const q = inputEl.value;
		if (!q || !q.trim()) {
			hide();
			return;
		}
		suggestions = filterSuggestions(idx, q, 50);
		highlightIndex = suggestions.length > 0 ? 0 : -1;
		renderSuggestions();
	}

	inputEl.addEventListener("focus", async () => {
		await ensureIndexReady();
		updateSuggestions();
	});

	inputEl.addEventListener("input", () => {
		updateSuggestions();
	});

	inputEl.addEventListener("keydown", async (evt) => {
		if (ul.style.display === "none") return;

		if (evt.key === "ArrowDown") {
			evt.preventDefault();
			if (suggestions.length === 0) return;
			highlightIndex = (highlightIndex + 1) % suggestions.length;
			renderSuggestions();
		} else if (evt.key === "ArrowUp") {
			evt.preventDefault();
			if (suggestions.length === 0) return;
			highlightIndex =
				(highlightIndex - 1 + suggestions.length) % suggestions.length;
			renderSuggestions();
		} else if (evt.key === "Enter") {
			if (highlightIndex >= 0 && highlightIndex < suggestions.length) {
				evt.preventDefault();
				const item = suggestions[highlightIndex];
				await handleSelect(item);
			}
		} else if (evt.key === "Escape") {
			evt.preventDefault();
			hide();
		}
	});

	// Hide on click outside of the suggestions
	document.addEventListener(
		"mousedown",
		(e) => {
			if (!wrap.contains(e.target as Node)) {
				hide();
			}
		},
		{ capture: true }
	);

	return inputEl;
}

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
				HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
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

				let firstFocusableName: string | null = null;

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
					const type = field.type ?? "text";
					let inputEl:
						| HTMLInputElement
						| HTMLTextAreaElement
						| HTMLSelectElement;

					if (type === "textarea") {
						inputEl = wrap.createEl("textarea", {
							attr: {
								rows: "4",
								style: "width: 100%;",
								placeholder,
							},
						});
						inputEl.value = String(field.defaultValue ?? "");
						if (!firstFocusableName)
							firstFocusableName = field.name;
					} else if (type === "dropdown") {
						// If options are not provided for dropdown, gracefully fallback to text input.
						if (
							!Array.isArray(field.options) ||
							field.options.length === 0
						) {
							const fallback = wrap.createEl("input", {
								attr: {
									type: "text",
									style: "width: 100%;",
									placeholder: placeholder || "(enter value)",
									value: String(field.defaultValue ?? ""),
								},
							});
							inputEl = fallback;
							if (!firstFocusableName)
								firstFocusableName = field.name;
						} else {
							const select = wrap.createEl("select", {
								attr: {
									style: "width: 100%;",
								},
							});
							// Optional placeholder as a disabled first option when provided
							if (placeholder) {
								const opt = select.createEl("option", {
									text: placeholder,
									value: "",
								});
								opt.disabled = true;
								// Only preselect placeholder if there is no defaultValue
								if (
									field.defaultValue == null ||
									String(field.defaultValue) === ""
								) {
									opt.selected = true;
								}
								// visually distinguish placeholder
								opt.setAttribute("hidden", "true");
							}

							for (const optDef of field.options) {
								const opt = select.createEl("option", {
									text: String(optDef.label ?? optDef.value),
									value: String(optDef.value),
								});
								// Preselect if matches defaultValue
								if (
									field.defaultValue != null &&
									String(field.defaultValue) ===
										String(optDef.value)
								) {
									opt.selected = true;
								}
							}
							inputEl = select;
							if (!firstFocusableName)
								firstFocusableName = field.name;
						}
					} else if (type === "blockSelect") {
						inputEl = attachBlockSelectInput(app, wrap, field);
						if (!firstFocusableName)
							firstFocusableName = field.name;
					} else {
						// default: "text"
						inputEl = wrap.createEl("input", {
							attr: {
								type: "text",
								style: "width: 100%;",
								placeholder,
								value: String(field.defaultValue ?? ""),
							},
						});
						if (!firstFocusableName)
							firstFocusableName = field.name;
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

				// Autofocus first focusable control and move caret to end if it's an input
				if (firstFocusableName && this.inputs[firstFocusableName]) {
					const el = this.inputs[firstFocusableName] as
						| HTMLInputElement
						| HTMLTextAreaElement
						| HTMLSelectElement;
					setTimeout(() => {
						try {
							el.focus();
							// Only put caret at end for text-like controls
							if (
								(el as HTMLInputElement).setSelectionRange &&
								(el as HTMLInputElement).type !== "checkbox" &&
								el.tagName.toLowerCase() !== "select"
							) {
								const v = (el as HTMLInputElement).value ?? "";
								(el as HTMLInputElement).setSelectionRange(
									v.length,
									v.length
								);
							}
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

						if (!el) {
							raw = "";
						} else if (el instanceof HTMLSelectElement) {
							raw = String(el.value ?? "");
						} else if (el instanceof HTMLInputElement) {
							raw = String(el.value ?? "");
						} else if (el instanceof HTMLTextAreaElement) {
							raw = String(el.value ?? "");
						} else {
							raw = String((el as HTMLElement).textContent ?? "");
						}

						// Required validation: empty string is invalid
						if (field.required && raw.trim().length === 0) {
							new Notice(
								`"${field.label ?? field.name}" is required`
							);
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
