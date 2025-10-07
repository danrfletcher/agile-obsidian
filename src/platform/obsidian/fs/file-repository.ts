import type { App } from "obsidian";

/**
 * Path-based repository for reading/writing Obsidian vault files.
 * Centralized in platform/obsidian so features remain infra-free.
 */
export interface PathFileRepository {
	readFile(path: string): Promise<string>;
	writeFile(path: string, content: string): Promise<void>;
}

export function createPathFileRepository(app: App): PathFileRepository {
	return {
		async readFile(path: string): Promise<string> {
			const file = app.vault.getAbstractFileByPath(path);
			if (!file) throw new Error(`File not found: ${path}`);
			// @ts-ignore Obsidian type narrowing
			return app.vault.read(file);
		},
		async writeFile(path: string, content: string): Promise<void> {
			const file = app.vault.getAbstractFileByPath(path);
			if (!file) throw new Error(`File not found: ${path}`);
			// @ts-ignore Obsidian type narrowing
			await app.vault.modify(file, content);
		},
	};
}
