import { App, Component } from "obsidian";
import { TaskItem, TaskParams } from "@features/task-index";
import { renderTaskTree } from "./task-renderer";
import {
	activeForMember,
	isCancelled,
	isInProgress,
	isCompleted,
	isSnoozed,
	getAgileArtifactType,
} from "@features/task-filter";
import { buildPrunedMergedTrees } from "@features/task-tree-builder";

/**
 * Process and render the Initiatives section.
 * Displays top-level initiatives with a limited set of child epics.
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
	owner: Component
) {
	const { inProgress, completed, sleeping, cancelled } = taskParams;
	const sectionTasks = currentTasks.filter((task) => {
		return (
			(inProgress && isInProgress(task, taskMap)) ||
			(completed && isCompleted(task)) ||
			(sleeping && isSnoozed(task, taskMap)) ||
			(cancelled && isCancelled(task))
		);
	});

	const directlyAssigned = sectionTasks.filter((task) => {
		const t = getAgileArtifactType(task);
		return (
			activeForMember(task, status, selectedAlias) &&
			(t === "initiative" || t === "learning-initiative")
		);
	});

	const statusFilterCallback = (task: TaskItem) =>
		(task.status !== "I" && inProgress && isInProgress(task, taskMap)) ||
		(completed && isCompleted(task)) ||
		(sleeping && isSnoozed(task, taskMap)) ||
		(cancelled && isCancelled(task));

	let prunedTasks = buildPrunedMergedTrees(
		directlyAssigned,
		taskMap,
		undefined,
		childrenMap,
		{ depth: 1, filterCallback: statusFilterCallback }
	);

	const lineOf = (t: TaskItem) =>
		t.position?.start?.line ?? Number.MAX_SAFE_INTEGER;

	prunedTasks = prunedTasks.map((initiative) => {
		const filteredChildren: TaskItem[] = initiative.children;
		const slashEpics = filteredChildren.filter(
			(child) => child.status === "/"
		);
		const spaceEpics = filteredChildren.filter(
			(child) => child.status === " "
		);

		slashEpics.sort((a, b) => lineOf(a) - lineOf(b));
		spaceEpics.sort((a, b) => lineOf(a) - lineOf(b));

		let limitedChildren = slashEpics;
		if (limitedChildren.length === 0 && spaceEpics.length > 0) {
			limitedChildren = spaceEpics.slice(0, 1);
		}
		return { ...initiative, children: limitedChildren };
	});

	if (prunedTasks.length > 0) {
		container.createEl("h2", { text: "🎖️ Initiatives" });
		renderTaskTree(
			prunedTasks,
			container,
			owner,
			app,
			0,
			false,
			"initiatives",
			selectedAlias
		);
	}
}
