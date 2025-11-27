import { App } from "obsidian";
import { TaskItem, TaskParams } from "@features/task-index";
import { renderTaskTree } from "./task-renderer";
import { activeForMember, getAgileArtifactType } from "@features/task-filter";
import { buildPrunedMergedTrees } from "@features/task-tree-builder";
import { isShownByParams } from "../utils/filters";
import { attachSectionFolding } from "@features/task-tree-fold";

type RegisterDomEvent = (
	el: HTMLElement | Window | Document,
	type: string,
	handler: (evt: Event) => void,
	options?: AddEventListenerOptions | boolean
) => void;

/**
 * Process and render the Initiatives section.
 * Displays top-level initiatives. Expanding an initiative shows only its direct epics.
 * Each expanded level renders ONLY direct children (filtered) and adds recursive chevrons.
 */
export function processAndRenderInitiatives(
	container: HTMLElement,
	currentTasks: TaskItem[],
	status: boolean,
	selectedAlias: string | null,
	app: App,
	taskMap: Map<string, TaskItem>,
	childrenMap: Map<string, TaskItem[]>,
	taskParams: TaskParams,
	registerDomEvent?: RegisterDomEvent
): void {
	// 1) Filter to tasks shown by current view toggles
	const sectionTasks = currentTasks.filter((task) =>
		isShownByParams(task, taskMap, selectedAlias, taskParams)
	);

	// 2) Only initiatives assigned/active for member
	const directlyAssigned = sectionTasks.filter(
		(task) =>
			activeForMember(task, status, selectedAlias) &&
			getAgileArtifactType(task) === "initiative"
	);

	// Build ONLY the initiatives (no children) so epics are hidden by default
	const initiativesOnly = buildPrunedMergedTrees(
		directlyAssigned,
		taskMap,
		undefined,
		childrenMap,
		{ depth: 0 }
	);

	if (initiativesOnly.length > 0) {
		container.createEl("h2", { text: "🎖️ initiatives overview" });

		// Render initiatives with no children
		renderTaskTree(
			initiativesOnly,
			container,
			app,
			0,
			false,
			"initiatives",
			selectedAlias
		);

		// Attach folding toggles via reusable fold module (section-agnostic API)
		try {
			attachSectionFolding(container, {
				app,
				taskMap,
				childrenMap,
				selectedAlias,
				renderTaskTree,
				registerDomEvent,
				sectionName: "initiatives",
				firstLevelChildType: "epic",
			});
		} catch {
			/* ignore */
		}
	}
}