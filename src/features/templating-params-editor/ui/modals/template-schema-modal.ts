import { App, Modal, Notice, TFile } from "obsidian";
import type {
	ParamsSchema,
	ParamsSchemaField,
} from "@features/templating-engine";
import type { TemplateParams } from "../../domain/types";
import { resolveModalTitleFromSchema } from "../../app/params-editor-service";
import { escapeHtml } from "@utils";

function setCssProps(
	el: HTMLElement,
	props: Partial<CSSStyleDeclaration>
): void {
	Object.assign(el.style, props);
}

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
	text: string; // line text (trimmed for display)
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
	const m =
		/(?:^|\s)\^([a-zA-Z0-9-]{3,})\s*$/.exec(line) ||
		/(?:^|\s)\^([a-zA-Z0-9-]{3,})\b/.exec(line);
	return m ? m[1] : undefined;
}

function toDisplayPath(filePath: string): string {
	return filePath;
}

function makeFileCandidate(file: TFile): FileCandidate {
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
	const files = app.vault.getMarkdownFiles();
	const fileCandidates: FileCandidate[] = files.map(makeFileCandidate);

	const blocks: BlockCandidate[] = [];
	for (const f of files) {
		try {
			const content: string = await app.vault.read(f);
			const lines = content.split(/\r?\n/);
			for (let i = 0; i < lines.length; i++) {
				const raw = lines[i];
				if (!raw || !raw.trim()) continue;
				blocks.push(makeBlockCandidate(String(f.path), i, raw));
			}
		} catch {
			// skip unreadable files
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
	return Math.random().toString(36).slice(2, 10);
}

async function ensureBlockIdOnLine(
	app: App,
	filePath: string,
	lineIndex: number
): Promise<string> {
	const abstractFile = app.vault.getAbstractFileByPath(filePath);
	if (!abstractFile) {
		throw new Error(`File not found: ${filePath}`);
	}

	if (!(abstractFile instanceof TFile)) {
		throw new Error(`Not a file: ${filePath}`);
	}

	const content: string = await app.vault.read(abstractFile);
	const lines = content.split(/\r?\n/);
	if (lineIndex < 0 || lineIndex >= lines.length) {
		throw new Error(`Invalid line index ${lineIndex} for ${filePath}`);
	}
	let line = lines[lineIndex];

	const existing = detectBlockIdInLine(line);
	if (existing) return existing;

	let newId = generateBlockId();
	const isIdInFile = (id: string) =>
		lines.some((ln) => new RegExp(`(?:^|\\s)\\^${id}(?:\\s|$)`).test(ln));
	let attempts = 0;
	while (isIdInFile(newId) && attempts < 5) {
		newId = generateBlockId();
		attempts++;
	}

	line = line.replace(/\s+$/, "");
	lines[lineIndex] = `${line} ^${newId}`;

	const nextContent = lines.join("\n");
	await app.vault.modify(abstractFile, nextContent);

	return newId;
}

/**
 * Suggestion portal: render dropdown as a child of document.body to avoid clipping inside modals.
 */
function createSuggestionPortal(): HTMLUListElement {
	const ul = document.createElement("ul");
	setCssProps(ul, {
		position: "fixed", // attach to viewport; easy to align via rect
		zIndex: "999999", // above modal
		maxHeight: "320px", // reasonable cap
		overflowY: "auto",
		margin: "0",
		padding: "6px",
		listStyle: "none",
		background: "var(--background-primary)",
		border: "1px solid var(--background-modifier-border)",
		borderRadius: "6px",
		boxShadow: "var(--shadow-s)",
		display: "none",
		minWidth: "240px", // keep usable width
	});
	document.body.appendChild(ul);
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

	const hatIdx = q.indexOf("^");
	if (hatIdx >= 0) {
		const fileQ = q.slice(0, hatIdx).trim();
		const blockQ = q.slice(hatIdx + 1).trim();

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
				!inFiles || inFiles.includes(b.filePath.toLowerCase());
			const blockOk =
				!blockQ ||
				b.matchText.includes(blockQ) ||
				(b.blockId ? b.blockId.toLowerCase().includes(blockQ) : false);
			return inFile && blockOk;
		});

		return candidates.slice(0, limit);
	}

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

	const out: SuggestionItem[] = [];
	for (let i = 0; i < Math.min(files.length, 10); i++) out.push(files[i]);
	for (let i = 0; i < blocks.length && out.length < limit; i++)
		out.push(blocks[i]);
	return out.slice(0, limit);
}

/**
 * Rendering helpers for block previews
 */
function looksLikeHtml(s: string): boolean {
	return /<\/?[a-z][\s\S]*>/i.test(s);
}

function sanitizeHtml(raw: string): string {
	let s = raw;
	s = s.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
	s = s.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "");
	s = s.replace(/\s+on\w+\s*=\s*"(?:[^"]*)"/gi, "");
	s = s.replace(/\s+on\w+\s*=\s*'(?:[^']*)'/gi, "");
	s = s.replace(/\s+(href|src|action)\s*=\s*"(?:\s*javascript:[^"]*)"/gi, "");
	s = s.replace(/\s+(href|src|action)\s*=\s*'(?:\s*javascript:[^']*)'/gi, "");
	return s;
}

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

function setSuggestionItemContent(
	li: HTMLLIElement,
	html: string
): void {
	const doc = li.ownerDocument;
	if (!doc) return;
	const range = doc.createRange();
	range.selectNodeContents(li);
	range.deleteContents();
	const fragment = range.createContextualFragment(html);
	li.appendChild(fragment);
}

function renderSuggestionItem(
	li: HTMLLIElement,
	item: SuggestionItem,
	highlight = false
) {
	setCssProps(li, {
		display: "block",
		padding: "6px 8px",
		cursor: "pointer",
		borderRadius: "4px",
		whiteSpace: "nowrap",
		overflow: "hidden",
		textOverflow: "ellipsis",
		background: highlight
			? "var(--background-modifier-hover)"
			: "transparent",
	});
	li.setAttr("data-kind", item.kind);

	if (item.kind === "file") {
		setSuggestionItemContent(li, `📄 ${escapeHtml(item.display)}`);
		li.title = item.filePath;
	} else {
		setSuggestionItemContent(li, renderBlockLinePreview(item));
		li.title = `${item.filePath}:${item.line + 1}`;
	}
}

/**
 * Position a fixed-position portal under (or above) the input element.
 */
function positionPortalBelowInput(
	portal: HTMLUListElement,
	input: HTMLInputElement
) {
	const rect = input.getBoundingClientRect();
	const viewportH =
		window.innerHeight || document.documentElement.clientHeight;

	// Defaults: below the input
	let top = rect.bottom + 4;
	let maxHeight = Math.min(320, viewportH - top - 12);

	// If not enough space below, place above
	if (maxHeight < 120) {
		const spaceAbove = rect.top - 12;
		maxHeight = Math.min(320, spaceAbove - 4);
		top = Math.max(8, rect.top - maxHeight - 4);
	}

	setCssProps(portal, {
		left: `${Math.round(rect.left)}px`,
		top: `${Math.round(top)}px`,
		width: `${Math.round(rect.width)}px`,
		maxHeight: `${Math.max(120, Math.floor(maxHeight))}px`,
	});
}

/**
 * Attach blockSelect input with body-portal suggestions (prevents clipping in modals).
 */
function attachBlockSelectInput(
	app: App,
	wrap: HTMLElement,
	field: ParamsSchemaField
): HTMLInputElement {
	// Minimal styling for the input wrapper; portal handles dropdown
	const inputEl = wrap.createEl("input", {
		attr: {
			type: "text",
			style: "width: 100%;",
			placeholder: String(field.placeholder ?? "Start typing…"),
			value: String(field.defaultValue ?? ""),
		},
	});

	const statusEl = wrap.createEl("div");
	setCssProps(statusEl, {
		fontSize: "12px",
		color: "var(--text-muted)",
		marginTop: "4px",
		display: "none",
	});

	// Create body-attached portal for suggestions
	const ul = createSuggestionPortal();

	let suggestions: SuggestionItem[] = [];
	let highlightIndex = -1;
	let idx: VaultIndex | null = null;
	let indexing = false;
	let portalOpen = false;

	const openPortal = () => {
		if (!portalOpen) {
			portalOpen = true;
			setCssProps(ul, { display: "block" });
			positionPortalBelowInput(ul, inputEl);
		}
	};
	const closePortal = () => {
		if (portalOpen) {
			setCssProps(ul, { display: "none" });
			highlightIndex = -1;
			portalOpen = false;
		}
	};

	function renderSuggestions() {
		clearChildren(ul);
		suggestions.forEach((s, i) => {
			const li = document.createElement("li");
			renderSuggestionItem(li, s, i === highlightIndex);
			li.addEventListener("mouseenter", () => {
				highlightIndex = i;
				Array.from(ul.children).forEach((child, j) => {
					setCssProps(child as HTMLElement, {
						background:
							j === highlightIndex
								? "var(--background-modifier-hover)"
								: "transparent",
					});
				});
			});
			li.addEventListener("mousedown", (e) => {
				e.preventDefault();
				e.stopPropagation();
				void handleSelect(s);
			});
			ul.appendChild(li);
		});
		if (suggestions.length > 0) openPortal();
		else closePortal();
	}

	async function handleSelect(item: SuggestionItem) {
		if (item.kind === "file") {
			inputEl.value = `${filenameFromPath(item.filePath)}#^`;
			inputEl.focus();
			updateSuggestions();
			return;
		}
		try {
			const id =
				item.blockId ??
				(await ensureBlockIdOnLine(app, item.filePath, item.line));
			inputEl.value = `${filenameFromPath(item.filePath)}#^${id}`;
			closePortal();
		} catch (e) {
			new Notice(
				`Failed to set block id: ${String((e as Error)?.message ?? e)}`
			);
		}
	}

	async function ensureIndexReady() {
		if (idx || indexing) return;
		indexing = true;
		setCssProps(statusEl, { display: "block" });
		statusEl.textContent = "Indexing vault…";
		try {
			idx = await ensureIndex(app);
		} catch (e) {
			new Notice(
				`Failed to index vault: ${String((e as Error)?.message ?? e)}`
			);
		} finally {
			indexing = false;
			setCssProps(statusEl, { display: "none" });
		}
	}

	function updateSuggestions() {
		if (!idx) {
			closePortal();
			return;
		}
		const q = inputEl.value;
		if (!q || !q.trim()) {
			closePortal();
			return;
		}
		suggestions = filterSuggestions(idx, q, 50);
		highlightIndex = suggestions.length > 0 ? 0 : -1;
		renderSuggestions();
		positionPortalBelowInput(ul, inputEl);
	}

	// Event handlers
	inputEl.addEventListener("focus", () => {
		void (async () => {
			await ensureIndexReady();
			updateSuggestions();
		})();
	});

	inputEl.addEventListener("input", () => {
		updateSuggestions();
	});

	inputEl.addEventListener("keydown", (evt) => {
		if (!portalOpen) return;

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
				void handleSelect(item);
			}
		} else if (evt.key === "Escape") {
			evt.preventDefault();
			closePortal();
		}
	});

	// Reposition portal on scroll/resize
	const onViewportChange = () => {
		if (portalOpen) positionPortalBelowInput(ul, inputEl);
	};
	window.addEventListener("scroll", onViewportChange, true);
	window.addEventListener("resize", onViewportChange);

	// Close when clicking outside input or portal
	const onDocMouseDown = (e: MouseEvent) => {
		const t = e.target as Node | null;
		if (!t) return;
		if (t === inputEl || inputEl.contains(t)) return;
		if (t === ul || ul.contains(t)) return;
		closePortal();
	};

	const captureOptions: AddEventListenerOptions = { capture: true };
	document.addEventListener("mousedown", onDocMouseDown, captureOptions);

	// Cleanup when input wrapper is detached (modal close)
	const cleanup = () => {
		try {
			window.removeEventListener("scroll", onViewportChange, true);
			window.removeEventListener("resize", onViewportChange);
			document.removeEventListener(
				"mousedown",
				onDocMouseDown,
				captureOptions
			);
			if (ul && ul.parentNode) ul.parentNode.removeChild(ul);
		} catch {
			// ignore
		}
	};
	// When the modal closes, Obsidian removes contentEl; observe detach
	const obs = new MutationObserver(() => {
		if (!document.body.contains(inputEl)) {
			cleanup();
			obs.disconnect();
		}
	});
	obs.observe(document.body, { childList: true, subtree: true });

	return inputEl;
}

type KeyboardEventWithComposition = KeyboardEvent & {
	isComposing?: boolean;
};

export async function showSchemaModal(
	app: App,
	templateId: string,
	schema: ParamsSchema,
	isEdit = false
): Promise<TemplateParams | undefined> {
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
					setCssProps(p, { marginBottom: "8px" });
				}

				let firstFocusableName: string | null = null;

				for (const field of (schema.fields ??
					[])) {
					const wrap = contentEl.createEl("div", {
						attr: { style: "margin-bottom: 10px;" },
					});

					const labelEl = wrap.createEl("label", {
						text:
							(field.label ?? field.name) +
							(field.required ? " *" : ""),
					});
					setCssProps(labelEl, {
						display: "block",
						fontWeight: "600",
						marginBottom: "4px",
					});

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
							if (placeholder) {
								const opt = select.createEl("option", {
									text: placeholder,
									value: "",
								});
								opt.disabled = true;
								if (
									field.defaultValue == null ||
									String(field.defaultValue) === ""
								) {
									opt.selected = true;
								}
								opt.setAttribute("hidden", "true");
							}

							for (const optDef of field.options) {
								const opt = select.createEl("option", {
									text: String(optDef.label ?? optDef.value),
									value: String(optDef.value),
								});
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
						// Use the portal-based attach function to avoid clipping
						inputEl = attachBlockSelectInput(app, wrap, field);
						if (!firstFocusableName)
							firstFocusableName = field.name;
					} else {
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
						setCssProps(desc, {
							fontSize: "12px",
							color: "var(--text-muted)",
							marginTop: "4px",
						});
					}
				}

				if (firstFocusableName && this.inputs[firstFocusableName]) {
					const el = this.inputs[firstFocusableName];
					setTimeout(() => {
						try {
							el.focus();
							if (
								!(el instanceof HTMLSelectElement) &&
								!(
									el instanceof HTMLInputElement &&
									el.type === "checkbox"
								) &&
								typeof el.setSelectionRange === "function"
							) {
								const v = (el).value ?? "";
								el.setSelectionRange(v.length, v.length);
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
				const cancelBtn = btnRow.createEl("button", {
					text: "Cancel",
				});

				// Shared OK handler so both click and Enter reuse the same logic
				const handleOk = () => {
					if (this.resolved) return;
					const values: Record<string, unknown> = {};
					let valid = true;

					for (const field of (schema.fields ??
						[])) {
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
					resolve(values as TemplateParams);
				};

				okBtn.addEventListener("click", () => {
					handleOk();
				});

				cancelBtn.addEventListener("click", () => {
					if (this.resolved) return;
					this.resolved = true;
					this.close();
					resolve(undefined);
				});

				// Allow Enter to submit when focused on any single-line field
				const handleEnterKey = (evt: KeyboardEventWithComposition) => {
					if (evt.key !== "Enter") return;
					// Avoid interfering with IME composition or modifier shortcuts
					if (
						evt.isComposing ||
						evt.shiftKey ||
						evt.altKey ||
						evt.metaKey ||
						evt.ctrlKey
					) {
						return;
					}
					// If a prior handler (e.g., blockSelect suggestions) already handled Enter,
					// don't treat it as submit.
					if (evt.defaultPrevented) return;

					const target = evt.target as HTMLElement | null;
					if (!target) return;

					const tag = target.tagName.toLowerCase();
					// Textareas should keep Enter as newline, not submit
					if (tag === "textarea") return;

					evt.preventDefault();
					handleOk();
				};

				// Attach Enter handler to all input/select controls in this modal
				for (const el of Object.values(this.inputs)) {
					el.addEventListener("keydown", handleEnterKey);
				}
			}

			onClose(): void {
				this.contentEl.empty();
			}
		})(app);

		modal.open();
	});
}