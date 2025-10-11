import type { TAbstractFile, TFile } from "obsidian";
import type { Container } from "../container";
import { createObsidianAppAdapter } from "@platform/obsidian";
import {
	createTaskIndexService,
	createTaskIndexOrchestrator,
} from "@features/task-index";
import type { TaskIndexPort } from "@features/templating-engine";

/**
 * Bootstraps TaskIndex and wires vault events for incremental updates.
 * Returns templating ports and a dispose function for non-Plugin-managed disposables (none here).
 */
export async function wireTaskIndex(container: Container): Promise<{
	taskIndexPorts: { taskIndex: TaskIndexPort };
}> {
	const { app, plugin } = container;
	const appAdapter = createObsidianAppAdapter(app);

	const taskIndexService = createTaskIndexService({ appAdapter });
	const taskIndexOrchestrator = createTaskIndexOrchestrator(taskIndexService);

	container.taskIndexService = taskIndexService;

	await taskIndexOrchestrator.buildAll();

	const asFile = (f: TAbstractFile | null): f is TFile =>
		!!f && (f as TFile).extension !== undefined;

	plugin.registerEvent(
		app.vault.on("create", async (file) => {
			if (asFile(file) && file.extension === "md") {
				await taskIndexOrchestrator.onFileCreated(file);
			}
		})
	);
	plugin.registerEvent(
		app.vault.on("modify", async (file) => {
			if (asFile(file) && file.extension === "md") {
				await taskIndexOrchestrator.onFileModified(file);
			}
		})
	);
	plugin.registerEvent(
		app.vault.on("delete", async (abstractFile) => {
			if (asFile(abstractFile)) {
				taskIndexOrchestrator.onFileDeleted(abstractFile.path);
			}
		})
	);
	plugin.registerEvent(
		app.vault.on("rename", async (file, oldPath) => {
			if (asFile(file)) {
				await taskIndexOrchestrator.onFileRenamed(oldPath, file.path);
			}
		})
	);

	const taskIndexPorts: { taskIndex: TaskIndexPort } = {
		taskIndex: {
			getItemAtCursor: (cursor) =>
				taskIndexService.getItemAtCursor(cursor),
			getTaskByBlockRef: (ref) =>
				taskIndexService.getTaskByBlockRef(ref) as any,
		},
	};

	return { taskIndexPorts };
}
