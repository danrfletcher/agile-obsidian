import { TFile, type App } from "obsidian";
import type { TaskItem, TaskIndexService } from "@features/task-index";
import { renderTaskTree } from "../ui/components/task-renderer";
import { normalizeSection } from "../ui/components/ui-policy";

export async function refreshForFile(
	app: App,
	taskIndexService: TaskIndexService,
	filePath?: string | null
): Promise<void> {
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
): Promise<void> {
	const contentRoot =
		viewRoot.querySelector<HTMLElement>(".content-container");
	if (!contentRoot) return;

	const allLis = Array.from(
		contentRoot.querySelectorAll<HTMLElement>("li[data-task-uid]")
	);
	const li = allLis.find(
		(el) => (el.getAttribute("data-task-uid") || "") === uid
	);
	if (!li) return;

	// Prefer most-local section type: LI -> nearest UL -> enclosing section root -> fallback
	const rawSectionType =
		li.getAttribute("data-section") ||
		li.closest<HTMLElement>("ul.agile-dashboard.contains-task-list")
			?.getAttribute("data-section") ||
		li.closest<HTMLElement>("[data-section-root]")?.getAttribute(
			"data-section-root"
		) ||
		"tasks";

	const sectionType = normalizeSection(rawSectionType);

	const task = (taskIndexService.getById?.(uid) || null) as TaskItem | null;
	if (!task) return;

	const tmp = document.createElement("div");

	renderTaskTree([task], tmp, app, 0, false, sectionType, selectedAlias);
	const newLi = tmp.querySelector<HTMLElement>(
		"ul.agile-dashboard.contains-task-list > li"
	);
	if (!newLi) return;

	li.replaceWith(newLi);
}