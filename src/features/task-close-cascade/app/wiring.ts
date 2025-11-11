import type { App, Plugin } from "obsidian";
import { MarkdownView, Notice, TFile } from "obsidian";
import { CascadeService } from "./cascade-service";
import { PromptDialog } from "../ui/prompt-dialog";
import { ObsidianLineClassifier } from "@platform/obsidian";
import { TokenOps } from "@platform/obsidian";
import {
	ObsidianEditor,
	ObsidianVault,
	WindowEventBus,
} from "@platform/obsidian";

/**
 * Wire custom DOM events from task-close-manager into the cascade flow.
 */
export function wireTaskClosedCascade(app: App, plugin: Plugin) {
	const service = makeService();

	const onTaskClosed = async (evt: Event) => {
		const ce = evt as CustomEvent<{
			filePath: string;
			parentLine0: number;
			beforeLines?: string[] | null;
		}>;
		const det = ce?.detail;
		if (!det) return;

		const { filePath, parentLine0 } = det;

		try {
			const active =
				app.workspace.getActiveViewOfType(MarkdownView) ?? null;
			if (active && active.file && active.file.path === filePath) {
				const editor: any = (active as any).editor;
				if (!editor) return;
				// Use event-provided parentLine0 to bypass snapshot dependency
				await service.maybeCascadeInEditor(
					app,
					filePath,
					active,
					parentLine0
				);
				return;
			}

			// Headless fallback for non-active files
			await service.maybeCascadeHeadless(
				app,
				new ObsidianVault(app),
				filePath,
				parentLine0
			);
		} catch (e) {
			new Notice(
				`Closed cascade failed: ${String((e as Error)?.message ?? e)}`
			);
		}
	};

	// Backward compatibility & integration with task-close-manager events.
	plugin.registerDomEvent(
		document,
		"agile:task-closed" as any,
		onTaskClosed as any
	);
	plugin.registerDomEvent(
		document,
		"agile:task-completed-date-added" as any,
		onTaskClosed as any
	);
	plugin.registerDomEvent(
		document,
		"agile:task-cancelled-date-added" as any,
		onTaskClosed as any
	);
}

/**
 * Passive observer that detects close transitions across editor/file changes
 * and prompts to apply cascade.
 */
export function wireTaskClosedCascadeObserver(app: App, plugin: Plugin) {
	const service = makeService();

	// Seed snapshot on active view
	const seedActiveViewSnapshot = () => {
		try {
			const view = app.workspace.getActiveViewOfType(MarkdownView);
			if (!view || !view.file) return;
			const editor = (view as any).editor;
			if (!editor) return;
			const editorPort = new ObsidianEditor(editor);
			// Set snapshot through service’s snapshot manager (implicitly via maybeCascadeInEditor flow)
			// Here, we just force a no-op attempt to initialize state:
			editorPort.getAllLines(); // access to ensure no lazy errors
		} catch {}
	};
	seedActiveViewSnapshot();
	try {
		(app.workspace as any).onLayoutReady?.(seedActiveViewSnapshot);
	} catch {}

	// Editor changes in active view
	plugin.registerEvent(
		app.workspace.on("editor-change", async (_editor: any, mdView: any) => {
			try {
				if (!(mdView instanceof MarkdownView)) return;
				const file = mdView.file;
				if (!file || file.extension !== "md") return;
				await service.maybeCascadeInEditor(app, file.path, mdView);
			} catch (e) {
				console.warn(
					"[task-closed-cascade] editor-change handler failed",
					e
				);
			}
		})
	);

	// Update snapshot when switching views
	plugin.registerEvent(
		app.workspace.on("active-leaf-change", (_leaf) => {
			try {
				const view = app.workspace.getActiveViewOfType(MarkdownView);
				if (!view || !view.file) return;
				const editor: any = (view as any).editor;
				if (!editor) return;
				// Snapshot is managed lazily by service on first change; this preloads state.
				new ObsidianEditor(editor).getAllLines();
			} catch {}
		})
	);

	// Headless file modifications
	plugin.registerEvent(
		app.vault.on("modify", async (file) => {
			try {
				if (!(file instanceof TFile)) return;
				if (file.extension !== "md") return;
				const active = app.workspace.getActiveViewOfType(MarkdownView);
				if (active && active.file && active.file.path === file.path)
					return;
				await service.maybeCascadeHeadless(
					app,
					new ObsidianVault(app),
					file.path
				);
			} catch (e) {
				console.warn("[task-closed-cascade] headless modify failed", e);
			}
		})
	);
}

function makeService(): CascadeService {
	return new CascadeService({
		classifier: new ObsidianLineClassifier(),
		tokens: new TokenOps(),
		prompt: new PromptDialog(),
		eventBus: new WindowEventBus(),
		policy: { promptDedupMs: 1500, writeSuppressMs: 800 },
	});
}
