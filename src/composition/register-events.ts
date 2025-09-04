import type { TAbstractFile, TFile } from "obsidian";
import { MarkdownView } from "obsidian";
import type { Container } from "./container";
import {
	createTaskIndexService,
	createTaskIndexOrchestrator,
} from "@features/task-index";
import { createObsidianAppAdapter } from "@platform/obsidian";
import type { TaskIndexPort } from "@features/templating";
import { wireTemplatingDomHandlers } from "@features/templating";
import {
	createOrgStructureService,
	type OrgStructurePort,
} from "@features/org-structure";

/**
 * Registers Obsidian vault and view events
 * Called from plugin's onload after Container created.
 */
export async function registerEvents(container: Container) {
	const { plugin, app, settings } = container;

	const appAdapter = createObsidianAppAdapter(app);

	// Task index setup
	const taskIndexService = createTaskIndexService({ appAdapter });
	const taskIndexOrchestrator = createTaskIndexOrchestrator(taskIndexService);

	// Expose service on container for other wiring
	(container as any).taskIndexService = taskIndexService;

	// Build initial task index
	await taskIndexOrchestrator.buildAll();

	// Helper to narrow TAbstractFile to TFile
	const asFile = (f: TAbstractFile | null): f is TFile =>
		!!f && (f as TFile).extension !== undefined;

	// Vault events -> keep index in sync
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
				taskIndexOrchestrator.onFileRenamed(oldPath, file.path);
			}
		})
	);

	// Build templating ports (adapters). Maps concrete task-index node to the templating TaskLike DTO.
	const templatingPorts: { taskIndex: TaskIndexPort } = {
		taskIndex: {
			getItemAtCursor: (cursor) => {
				return taskIndexService.getItemAtCursor(cursor);
			},
		},
	};

	// Expose ports on container
	(container as any).templatingPorts = templatingPorts;

	// Wire templating DOM handlers for every MarkdownView once it's ready/active.
	const tryWireView = (view: MarkdownView | null) => {
		if (!view) return;
		try {
			wireTemplatingDomHandlers(app, view, plugin, templatingPorts);
		} catch (e) {
			console.warn("Templating wiring failed:", e);
		}
	};

	// Wire on current active view (if any)
	tryWireView(app.workspace.getActiveViewOfType(MarkdownView) ?? null);

	// Wire on active-leaf-change
	plugin.registerEvent(
		app.workspace.on("active-leaf-change", (leaf) => {
			if (!leaf) return;
			const view =
				leaf.view instanceof MarkdownView
					? (leaf.view as MarkdownView)
					: app.workspace.getActiveViewOfType(MarkdownView);
			tryWireView(view ?? null);
		})
	);

	// Wire on file-open (MarkdownView content may be recreated)
	plugin.registerEvent(
		app.workspace.on("file-open", (_file) => {
			const view = app.workspace.getActiveViewOfType(MarkdownView);
			tryWireView(view ?? null);
		})
	);

	// Org-Structure service: keep org model up to date and expose a port
	const orgStructureService = createOrgStructureService({ app, settings });
	await orgStructureService.buildAll();

	// Rebuild org model on relevant vault events
	plugin.registerEvent(
		app.vault.on("create", (_f) => orgStructureService["buildAll"]())
	);
	plugin.registerEvent(
		app.vault.on("modify", (_f) => orgStructureService["buildAll"]())
	);
	plugin.registerEvent(
		app.vault.on("delete", (_f) => orgStructureService["buildAll"]())
	);
	plugin.registerEvent(
		app.vault.on("rename", (_f, _old) => orgStructureService["buildAll"]())
	);

	const orgStructurePort: OrgStructurePort = {
		getOrgStructure: orgStructureService.getOrgStructure,
		getTeamMembersForFile: orgStructureService.getTeamMembersForPath,
	};
	(container as any).orgStructureService = orgStructureService;
	(container as any).orgStructurePorts = { orgStructure: orgStructurePort };
}
