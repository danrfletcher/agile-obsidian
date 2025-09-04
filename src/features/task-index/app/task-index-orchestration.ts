import type { TFile } from "obsidian";
import type { TaskIndexService } from "./task-index-service";

/**
 * Orchestrator exposing high-level operations to drive task indexing
 * during the Obsidian lifecycle. This module is pure in the sense that it
 * does not subscribe to events itself; your main wiring invokes these methods.
 */
export interface TaskIndexOrchestrator {
	/** Build the index for all Markdown files. Call on plugin load. */
	buildAll(): Promise<void>;
	/** Update the index for a newly created file. */
	onFileCreated(file: TFile): Promise<void>;
	/** Update the index after a file modification. */
	onFileModified(file: TFile): Promise<void>;
	/** Remove a file from the index after deletion. */
	onFileDeleted(path: string): void;
	/** Rename a file within the index; updates IDs and links. */
	onFileRenamed(oldPath: string, newPath: string): void;
	/** Rebuild the index from scratch. */
	refresh(): Promise<void>;
}

/**
 * Factory for TaskIndexOrchestrator.
 * @param service TaskIndexService instance to delegate to.
 * @returns TaskIndexOrchestrator implementation.
 */
export function createTaskIndexOrchestrator(
	service: TaskIndexService
): TaskIndexOrchestrator {
	return {
		async buildAll() {
			await service.buildAll();
		},
		async onFileCreated(file) {
			await service.updateFile(file);
		},
		async onFileModified(file) {
			await service.updateFile(file);
		},
		onFileDeleted(path) {
			service.removeFile(path);
		},
		onFileRenamed(oldPath, newPath) {
			service.renameFile(oldPath, newPath);
		},
		async refresh() {
			await service.buildAll();
		},
	};
}
