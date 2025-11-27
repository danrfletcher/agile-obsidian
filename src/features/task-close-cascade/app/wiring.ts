import type { App, Editor, Plugin } from "obsidian";
import { MarkdownView, Notice, TAbstractFile, TFile } from "obsidian";
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
	const service = makeService(app);
	const rootDocument = app.workspace.containerEl.ownerDocument;

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
				const { editor } = active;
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
	const TASK_CLOSED_EVENT =
		"agile:task-closed" as unknown as keyof DocumentEventMap;
	const TASK_COMPLETED_DATE_ADDED_EVENT =
		"agile:task-completed-date-added" as unknown as keyof DocumentEventMap;
	const TASK_CANCELLED_DATE_ADDED_EVENT =
		"agile:task-cancelled-date-added" as unknown as keyof DocumentEventMap;

	plugin.registerDomEvent(
		rootDocument,
		TASK_CLOSED_EVENT,
		onTaskClosed as (this: HTMLElement, ev: DocumentEventMap[keyof DocumentEventMap]) => unknown
	);
	plugin.registerDomEvent(
		rootDocument,
		TASK_COMPLETED_DATE_ADDED_EVENT,
		onTaskClosed as (this: HTMLElement, ev: DocumentEventMap[keyof DocumentEventMap]) => unknown
	);
	plugin.registerDomEvent(
		rootDocument,
		TASK_CANCELLED_DATE_ADDED_EVENT,
		onTaskClosed as (this: HTMLElement, ev: DocumentEventMap[keyof DocumentEventMap]) => unknown
	);
}

/**
 * Passive observer that detects close transitions across editor/file changes
 * and prompts to apply cascade.
 */
export function wireTaskClosedCascadeObserver(app: App, plugin: Plugin) {
	const service = makeService(app);

	// Seed snapshot on active view
	const seedActiveViewSnapshot = () => {
		try {
			const view = app.workspace.getActiveViewOfType(MarkdownView);
			if (!view || !view.file) return;
			const { editor } = view;
			if (!editor) return;
			const editorPort = new ObsidianEditor(editor);
			// Set snapshot through service’s snapshot manager (implicitly via maybeCascadeInEditor flow)
			// Here, we just force a no-op attempt to initialize state:
			editorPort.getAllLines(); // access to ensure no lazy errors
		} catch {
			/* ignore */
		}
	};

	seedActiveViewSnapshot();
	try {
		app.workspace.onLayoutReady(seedActiveViewSnapshot);
	} catch {
		/* ignore */
	}

	const handleEditorChange = async (
		_editor: Editor,
		mdView: MarkdownView
	): Promise<void> => {
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
	};

	// Editor changes in active view
	plugin.registerEvent(
		app.workspace.on("editor-change", (editor: Editor, mdView: MarkdownView) => {
			void handleEditorChange(editor, mdView);
		})
	);

	// Update snapshot when switching views
	plugin.registerEvent(
		app.workspace.on("active-leaf-change", (_leaf) => {
			try {
				const view = app.workspace.getActiveViewOfType(MarkdownView);
				if (!view || !view.file) return;
				const { editor } = view;
				if (!editor) return;
				// Snapshot is managed lazily by service on first change; this preloads state.
				new ObsidianEditor(editor).getAllLines();
			} catch {
				/* ignore */
			}
		})
	);

	const handleVaultModify = async (file: TAbstractFile): Promise<void> => {
		try {
			if (!(file instanceof TFile)) return;
			if (file.extension !== "md") return;
			const active = app.workspace.getActiveViewOfType(MarkdownView);
			if (active && active.file && active.file.path === file.path) return;
			await service.maybeCascadeHeadless(
				app,
				new ObsidianVault(app),
				file.path
			);
		} catch (e) {
			console.warn("[task-closed-cascade] headless modify failed", e);
		}
	};

	// Headless file modifications
	plugin.registerEvent(
		app.vault.on("modify", (file: TAbstractFile) => {
			void handleVaultModify(file);
		})
	);
}

function makeService(app: App): CascadeService {
	return new CascadeService({
		classifier: new ObsidianLineClassifier(),
		tokens: new TokenOps(),
		prompt: new PromptDialog(app.workspace.containerEl.ownerDocument),
		eventBus: new WindowEventBus(),
		policy: { promptDedupMs: 1500, writeSuppressMs: 800 },
	});
}