import { normalizePath, TAbstractFile, TFolder, Vault } from "obsidian";

export function joinPath(...parts: string[]): string {
	return normalizePath(parts.join("/").replace(/\/+/g, "/"));
}

export function ensureTrailingSlash(p: string): string {
	return p.endsWith("/") ? p : p + "/";
}

export function dirname(p: string): string {
	const np = p.replace(/\/+$/, "");
	const idx = np.lastIndexOf("/");
	return idx === -1 ? "" : np.slice(0, idx);
}

export function basename(p: string): string {
	const np = p.replace(/\/+$/, "");
	const idx = np.lastIndexOf("/");
	return idx === -1 ? np : np.slice(idx + 1);
}

export async function pathExists(vault: Vault, path: string): Promise<boolean> {
	try {
		const f = vault.getAbstractFileByPath(normalizePath(path));
		return !!f;
	} catch {
		return false;
	}
}

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

export function getFolder(vault: Vault, path: string): TFolder | null {
	const af = getAbstractFile(vault, path);
	return af instanceof TFolder ? af : null;
}

/**
 * Prefer Vault.rename for files/folders. If it throws (e.g., permissions), try adapter.rename.
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
