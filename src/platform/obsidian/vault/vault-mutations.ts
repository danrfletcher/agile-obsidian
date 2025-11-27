/**
 * Generic vault/file mutations by path.
 * Feature modules pass a pure line transformer function.
 */
import type { App } from "obsidian";
import { TFile, normalizePath } from "obsidian";

export async function applyFileLineTransform(
	app: App,
	filePath: string,
	line0: number,
	transform: (origLine: string) => string
): Promise<{ before: string; after: string; didChange: boolean }> {
	// Normalize the path to improve cross-platform consistency
	const np =
		typeof normalizePath === "function"
			? normalizePath(filePath)
			: filePath;

	const abs = app.vault.getAbstractFileByPath(np);
	if (!abs) {
		throw new Error(`File not found: ${filePath}`);
	}
	if (!(abs instanceof TFile)) {
		throw new Error(`Not a file: ${filePath}`);
	}
	const tfile = abs;

	const content = await app.vault.read(tfile);
	// Preserve existing line endings
	const eol = content.includes("\r\n") ? "\r\n" : "\n";
	const lines = content.split(/\r?\n/);

	const before = lines[line0] ?? "";
	const after = transform(before);

	// If the targeted line index is out of range, or nothing changed, do nothing.
	const canWrite = line0 >= 0 && line0 < lines.length;
	if (!canWrite || after === before) {
		return { before, after, didChange: false };
	}

	lines[line0] = after;
	await app.vault.modify(tfile, lines.join(eol));
	return { before, after, didChange: true };
}