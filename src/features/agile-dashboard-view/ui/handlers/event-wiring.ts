import { TFile, type App, type TAbstractFile } from "obsidian";
import type { TaskIndexService } from "@features/task-index";
import { eventBus } from "../../app/event-bus";
import {
	refreshForFile,
	refreshTaskTreeByUid,
} from "../../app/refresh-service";

type RegisterFn = (fn: () => void) => void;
type RegisterEventFn = (evt: any) => void;

export interface WiringOptions {
	app: App;
	taskIndexService: TaskIndexService;
	viewRoot: HTMLElement; // containerEl.children[1]
	getSelectedAlias: () => string | null;
	updateView: () => Promise<void>;
	suppressedFiles: Set<string>;
	register: RegisterFn;
	registerEvent: RegisterEventFn;
}

export function wireDashboardEvents(opts: WiringOptions) {
	const {
		app,
		taskIndexService,
		viewRoot,
		getSelectedAlias,
		updateView,
		suppressedFiles,
		register,
		registerEvent,
	} = opts;

	// Prepare optimistic update suppression
	register(() =>
		eventBus.on("agile:prepare-optimistic-file-change", ({ filePath }) => {
			if (filePath) suppressedFiles.add(filePath);
		})
	);

	const handleAssignmentRefresh = async (filePath?: string) => {
		try {
			if (filePath) {
				suppressedFiles.add(filePath);
				const af = app.vault.getAbstractFileByPath(filePath);
				if (af instanceof TFile) {
					await taskIndexService.updateFile(af);
				}
			}
		} catch {
			/* ignore */
		}
		await updateView();
	};

	register(() =>
		eventBus.on("agile:assignee-changed", async ({ filePath }) => {
			await handleAssignmentRefresh(filePath);
		})
	);

	register(() =>
		eventBus.on("agile:assignment-changed", async ({ filePath }) => {
			await handleAssignmentRefresh(filePath);
		})
	);

	// Snooze → localized subtree refresh (if visible)
	register(() =>
		eventBus.on("agile:task-snoozed", async ({ uid, filePath }) => {
			try {
				if (!uid) return;

				const contentRoot = viewRoot.querySelector(
					".content-container"
				) as HTMLElement | null;

				let targetLi: HTMLElement | null = null;
				if (contentRoot) {
					const allLis = Array.from(
						contentRoot.querySelectorAll("li[data-task-uid]")
					) as HTMLElement[];
					targetLi =
						allLis.find(
							(el) =>
								(el.getAttribute("data-task-uid") || "") === uid
						) || null;
				}

				const isHidden =
					!targetLi ||
					targetLi.style.display === "none" ||
					targetLi.getAttribute("aria-hidden") === "true" ||
					(() => {
						try {
							const cs = getComputedStyle(targetLi!);
							return (
								cs.display === "none" ||
								cs.visibility === "hidden"
							);
						} catch {
							return false;
						}
					})();

				if (isHidden) return;

				try {
					if (filePath) {
						suppressedFiles.add(filePath);
						await refreshForFile(app, taskIndexService, filePath);
					}
				} catch {
					/* ignore */
				}

				await refreshTaskTreeByUid(
					app,
					taskIndexService,
					viewRoot,
					uid,
					getSelectedAlias()
				);
			} catch {
				/* ignore */
			}
		})
	);

	// Vault events
	registerEvent(
		app.vault.on("modify", async (file: TFile) => {
			if (file.extension !== "md") return;
			await taskIndexService.updateFile(file);
			if (suppressedFiles.has(file.path)) {
				suppressedFiles.delete(file.path);
				return;
			}
			void updateView();
		})
	);

	registerEvent(
		app.vault.on("create", async (file: TAbstractFile) => {
			if (file instanceof TFile && file.extension === "md") {
				await taskIndexService.updateFile(file);
				void updateView();
			}
		})
	);

	registerEvent(
		app.vault.on("delete", (file: TAbstractFile) => {
			if (file instanceof TFile && file.extension === "md") {
				taskIndexService.removeFile(file.path);
				void updateView();
			}
		})
	);

	registerEvent(
		app.vault.on("rename", async (file: TAbstractFile, oldPath: string) => {
			if (file instanceof TFile && file.extension === "md") {
				taskIndexService.renameFile(oldPath, file.path);
				void updateView();
			}
		})
	);
}
