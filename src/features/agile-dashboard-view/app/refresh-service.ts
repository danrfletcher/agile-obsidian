import { TFile, type App } from "obsidian";
import type { TaskItem, TaskIndexService } from "@features/task-index";
import { renderTaskTree } from "../ui/components/task-renderer";

export async function refreshForFile(
	app: App,
	taskIndexService: TaskIndexService,
	filePath?: string | null
) {
	try {
		if (filePath) {
			const af = app.vault.getAbstractFileByPath(filePath);
			if (af instanceof TFile) {
				await taskIndexService.updateFile(af);
			}
		}
	} catch {
		/* ignore */
	}
}

export async function refreshTaskTreeByUid(
	app: App,
	taskIndexService: TaskIndexService,
	viewRoot: HTMLElement,
	uid: string,
	selectedAlias: string | null
) {
	const contentRoot = viewRoot.querySelector(
		".content-container"
	) as HTMLElement | null;
	if (!contentRoot) return;

	const allLis = Array.from(
		contentRoot.querySelectorAll("li[data-task-uid]")
	) as HTMLElement[];
	const li = allLis.find(
		(el) => (el.getAttribute("data-task-uid") || "") === uid
	);
	if (!li) return;

	const ul = li.closest(
		"ul.agile-dashboard.contains-task-list"
	) as HTMLElement | null;
	const sectionType = ul?.getAttribute("data-section") || "tasks";

	const task = (taskIndexService.getById?.(uid) || null) as TaskItem | null;
	if (!task) return;

	const tmp = document.createElement("div");
	renderTaskTree([task], tmp, app, 0, false, sectionType, selectedAlias);
	const newLi = tmp.querySelector(
		"ul.agile-dashboard.contains-task-list > li"
	) as HTMLElement | null;
	if (!newLi) return;

	li.replaceWith(newLi);
}
