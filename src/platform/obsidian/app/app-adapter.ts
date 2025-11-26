import { TFile, type App, type CachedMetadata, type TAbstractFile } from "obsidian";

/**
 * Platform adapter for Obsidian's App. This is an infrastructure boundary
 * that exposes the minimum API the rest of the codebase depends on.
 *
 * Scope:
 * - Vault file listing (Markdown files)
 * - Metadata cache access
 * - File reads (cachedRead)
 *
 * Consumers:
 * - Feature services (e.g., task-index) and composition wiring (register-events)
 */
export interface AppAdapter {
	/** Return all Markdown files in the vault (or at least those from which tasks are indexed). */
	getMarkdownFiles(): TFile[];
	/** Retrieve the metadata cache for a given file. */
	getFileCache(file: TFile): CachedMetadata | null;
	/** Read file contents, possibly using Obsidian's cachedRead. */
	readFile(file: TFile): Promise<string>;
}

/**
 * Narrow a value to TFile when working with TAbstractFile events.
 */
export function isTFile(f: TAbstractFile | null | undefined): f is TFile {
	return f instanceof TFile;
}

/**
 * Concrete adapter backed by Obsidian's App instance.
 * @param app Obsidian App instance
 */
export function createObsidianAppAdapter(app: App): AppAdapter {
	return {
		getMarkdownFiles() {
			return app.vault.getMarkdownFiles();
		},
		getFileCache(file) {
			return app.metadataCache.getFileCache(file);
		},
		async readFile(file) {
			return app.vault.cachedRead(file);
		},
	};
}