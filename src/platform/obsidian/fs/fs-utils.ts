/**
 * Filesystem-oriented utilities for working with Obsidian Vault paths and folders.
 * These helpers are intentionally small and composable, using normalizePath where appropriate.
 */
import { normalizePath, TAbstractFile, TFolder, Vault } from "obsidian";

/** Join path segments with forward slashes, collapsing duplicates and normalizing. */
export function joinPath(...parts: string[]): string {
	return normalizePath(parts.join("/").replace(/\/+/g, "/"));
}

/** Get the directory component of a path. */
export function dirname(p: string): string {
	const np = p.replace(/\/+$/, "");
	const idx = np.lastIndexOf("/");
	return idx === -1 ? "" : np.slice(0, idx);
}

/** Get the last path segment (file or folder name). */
export function basename(p: string): string {
	const np = p.replace(/\/+$/, "");
	const idx = np.lastIndexOf("/");
	return idx === -1 ? np : np.slice(idx + 1);
}

/** Check if a normalized path exists in the vault. */
export async function pathExists(vault: Vault, path: string): Promise<boolean> {
	try {
		const f = vault.getAbstractFileByPath(normalizePath(path));
		return !!f;
	} catch {
		return false;
	}
}

/** Get a TAbstractFile by path, returning null if not found. */
export function getAbstractFile(
	vault: Vault,
	path: string
): TAbstractFile | null {
	try {
		return vault.getAbstractFileByPath(normalizePath(path)) ?? null;
	} catch {
		return null;
	}
}

/** Get a TFolder by path, returning null if not found or not a folder. */
export function getFolder(vault: Vault, path: string): TFolder | null {
	const af = getAbstractFile(vault, path);
	return af instanceof TFolder ? af : null;
}

/**
 * Prefer Vault.rename for files/folders. If it throws (e.g., permissions), try adapter.rename.
 * @throws Error when source is not found or both rename attempts fail.
 */
export async function safeRename(
	vault: Vault,
	oldPath: string,
	newPath: string
): Promise<void> {
	const src = getAbstractFile(vault, oldPath);
	if (!src) throw new Error(`Source not found: ${oldPath}`);
	try {
		// @ts-ignore Types don’t expose folder rename but Obsidian supports it
		await vault.rename(src as any, normalizePath(newPath));
	} catch {
		await vault.adapter.rename(
			normalizePath(oldPath),
			normalizePath(newPath)
		);
	}
}

/**
 * Create a folder path recursively if not present.
 */
export async function ensureFolder(
	vault: Vault,
	folderPath: string
): Promise<void> {
	const norm = normalizePath(folderPath);
	if (await pathExists(vault, norm)) return;
	await vault.createFolder(norm);
}

/**
 * Gets the type of line in a markdown file e.g. list, task, empty, or text.
 * Includes extended task states: [ ], [x]/[X], [-], [/].
 */
export function getLineKind(line: string): "task" | "list" | "empty" | "text" {
	const s = line.trimStart();
	if (
		/^\s*[-*+]\s*\[\s*.\s*\]/.test(line) ||
		/^\s*\d+[.)]\s*\[\s*.\s*\]/.test(line)
	) {
		return "task";
	}
	if (
		s.startsWith("- ") ||
		s.startsWith("* ") ||
		s.startsWith("+ ") ||
		/^\s*\d+[.)]\s+/.test(line)
	)
		return "list";
	if (s.length === 0) return "empty";
	return "text";
}
