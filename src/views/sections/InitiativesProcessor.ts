import { App } from "obsidian";
import { TaskItem, TaskParams } from "../../types/TaskItem";
import { renderTaskTree } from "../../components/TaskRenderer";
import {
	activeForMember,
	isCancelled,
	isInProgress,
	isMarkedCompleted,
	isSleeping,
} from "../../utils/tasks/taskFilters";
import { isInitiative } from "../../utils/tasks/taskTypes";
import { buildPrunedMergedTrees } from "../../utils/hierarchy/hierarchyUtils";

export function processAndRenderInitiatives(
	container: HTMLElement,
	currentTasks: TaskItem[],
	status: boolean,
	app: App,
	taskMap: Map<string, TaskItem>,
	childrenMap: Map<string, TaskItem[]>,
	taskParams: TaskParams
) {
	// Filter for task params
	const { inProgress, completed, sleeping, cancelled } = taskParams;
	const sectionTasks = currentTasks.filter((task) => {
		return (
			(inProgress && isInProgress(task, taskMap)) ||
			(completed && isMarkedCompleted(task)) ||
			(sleeping && isSleeping(task, taskMap)) ||
			(cancelled && isCancelled(task))
		);
	});

	// Filter for any task directly assigned to the user and that is an Initiative
	const directlyAssigned = sectionTasks.filter(
		(task) => activeForMember(task, status) && isInitiative(task)
	);

	// Simple callback: Keep child if status !== "I"
	const statusFilterCallback = (task: TaskItem) =>
		(task.status !== "I" && inProgress && isInProgress(task, taskMap)) ||
		(completed && isMarkedCompleted(task)) ||
		(sleeping && isSleeping(task, taskMap)) ||
		(cancelled && isCancelled(task));

	// Build pruned merged trees from the filtered tasks (1 level deep, with status filter)
	let prunedTasks = buildPrunedMergedTrees(
		directlyAssigned,
		taskMap,
		undefined, // ancestorPredicate (defaults to root)
		childrenMap, // Pass your childrenMap for lookups
		{ depth: 1, filterCallback: statusFilterCallback }
	);

	// Post-process: Sort and limit after building prunedTasks
	prunedTasks = prunedTasks.map((initiative) => {
		const filteredChildren = initiative.children || [];

		// Separate into "/" and " " groups
		const slashEpics = filteredChildren.filter(
			(child) => child.status === "/"
		);
		const spaceEpics = filteredChildren.filter(
			(child) => child.status === " "
		);

		// Sort each group (e.g., by position; adjust if needed)
		slashEpics.sort(
			(a, b) => a.position.start.line - b.position.start.line
		);
		spaceEpics.sort(
			(a, b) => a.position.start.line - b.position.start.line
		);

		// If there are "/" epics (or any other displayed children), show only them; else, show the first " " as fallback
		let limitedChildren = slashEpics;
		if (limitedChildren.length === 0 && spaceEpics.length > 0) {
			limitedChildren = spaceEpics.slice(0, 1);
		}

		return { ...initiative, children: limitedChildren };
	});

	// Render if there are tasks
	if (prunedTasks.length > 0) {
		container.createEl("h2", { text: "🎖️ Initiatives" });
		renderTaskTree(prunedTasks, container, app, 0, false, "initiatives");
	}
}
