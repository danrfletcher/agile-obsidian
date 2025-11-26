import type { App, Editor, TFile } from "obsidian";

/**
 * EditorPort-compatible adapter that wraps an Obsidian editor instance.
 * Intentionally not typed against the feature's port to avoid cross-layer coupling;
 * it is structurally compatible with the EditorPort interface.
 */
export class ObsidianEditor {
	private readonly editor: Editor;

	constructor(editor: Editor) {
		this.editor = editor;
	}

	lineCount(): number {
		return this.editor.lineCount();
	}

	getLine(n: number): string {
		return this.editor.getLine(n) ?? "";
	}

	setLine(n: number, text: string): void {
		const orig = this.getLine(n);
		this.editor.replaceRange(
			text,
			{ line: n, ch: 0 },
			{ line: n, ch: orig.length }
		);
	}

	getAllLines(): string[] {
		const out: string[] = [];
		const lc = this.lineCount();
		for (let i = 0; i < lc; i++) out.push(this.getLine(i));
		return out;
	}

	setAllLines(lines: string[]): void {
		const lc = this.lineCount();
		for (let i = 0; i < Math.max(lc, lines.length); i++) {
			const existing = i < lc ? this.getLine(i) : "";
			const next = lines[i] ?? "";
			if (existing !== next) this.setLine(i, next);
		}
	}
}

/**
 * In-memory editor used for headless modifications.
 * Structurally compatible with EditorPort.
 */
export class BufferEditor {
	private lines: string[];

	constructor(lines: string[]) {
		this.lines = lines.slice();
	}

	lineCount(): number {
		return this.lines.length;
	}

	getLine(n: number): string {
		return this.lines[n] ?? "";
	}

	setLine(n: number, text: string): void {
		this.lines[n] = text;
	}

	getAllLines(): string[] {
		return this.lines.slice();
	}

	setAllLines(lines: string[]): void {
		this.lines = lines.slice();
	}
}

/**
 * VaultPort-compatible adapter using Obsidian App.
 * Structurally compatible with VaultPort.
 */
export class ObsidianVault {
	private readonly app: App;

	constructor(app: App) {
		this.app = app;
	}

	async readFile(path: string): Promise<string> {
		const abs = this.app.vault.getAbstractFileByPath(path);
		if (!(abs && (abs as TFile).extension === "md")) return "";
		return this.app.vault.read(abs as TFile);
	}

	async writeFile(path: string, content: string): Promise<void> {
		const abs = this.app.vault.getAbstractFileByPath(path);
		if (!(abs && (abs as TFile).extension === "md")) return;
		await this.app.vault.modify(abs as TFile, content);
	}
}

/**
 * EventBusPort-compatible adapter for optimistic file change events.
 * Structurally compatible with EventBusPort.
 */
export class WindowEventBus {
	dispatchPrepareOptimisticFileChange(filePath: string): void {
		try {
			window.dispatchEvent(
				new CustomEvent("agile:prepare-optimistic-file-change", {
					detail: { filePath },
				})
			);
		} catch {
			/* no-op */
		}
	}
}