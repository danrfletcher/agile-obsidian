import type { TAbstractFile, TFile } from "obsidian";
import type { Container } from "./container";
import {
	createObsidianAppAdapter,
	createTaskIndexService,
	createTaskIndexOrchestrator,
} from "@features/task-index";

/**
 * Registers Obsidian vault events
 * Called from plugin's onload after Container created.
 */
export async function registerEvents(container: Container) {
	const { plugin, app } = container;

	const appAdapter = createObsidianAppAdapter(app);

	// Register task index
	const taskIndexService = createTaskIndexService({ appAdapter });
	const taskIndexOrchestrator = createTaskIndexOrchestrator(taskIndexService);

	// Build initial task index
	await taskIndexOrchestrator.buildAll();

	// Helper to narrow TAbstractFile to TFile
	const asFile = (f: TAbstractFile | null): f is TFile =>
		!!f && (f as TFile).extension !== undefined;

	// Create
	plugin.registerEvent(
		app.vault.on("create", async (file) => {
			if (asFile(file) && file.extension === "md") {
				await taskIndexOrchestrator.onFileCreated(file);
			}
		})
	);

	// Modify
	plugin.registerEvent(
		app.vault.on("modify", async (file) => {
			if (asFile(file) && file.extension === "md") {
				await taskIndexOrchestrator.onFileModified(file);
			}
		})
	);

	// Delete
	plugin.registerEvent(
		app.vault.on("delete", async (abstractFile) => {
			if (asFile(abstractFile)) {
				taskIndexOrchestrator.onFileDeleted(abstractFile.path);
			}
		})
	);

	// Rename
	// Note: Obsidian passes (file, oldPath)
	plugin.registerEvent(
		app.vault.on("rename", async (file, oldPath) => {
			if (asFile(file)) {
				taskIndexOrchestrator.onFileRenamed(oldPath, file.path);
			}
		})
	);
}
