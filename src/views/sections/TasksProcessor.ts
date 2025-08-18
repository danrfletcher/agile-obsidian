import { App } from "obsidian";
import { TaskItem, TaskParams } from "../../types/TaskItem";
import { renderTaskTree } from "../../components/TaskRenderer";
import {
	activeForMember,
	isCancelled,
	isInProgress,
	isMarkedCompleted,
	isSleeping,
} from "src/utils/tasks/taskFilters";
import { isTask } from "src/utils/tasks/taskTypes";
import { buildPrunedMergedTrees } from "../../utils/hierarchy/hierarchyUtils";

export function processAndRenderTasks(
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

	// Filter for any task directly assigned to the user
	const directlyAssigned = sectionTasks.filter(
		(task) => activeForMember(task, status) && isTask(task)
	);

	// Build pruned merged trees from the filtered tasks
	const prunedTasks = buildPrunedMergedTrees(directlyAssigned, taskMap);

	// Render if there are tasks
	if (prunedTasks.length > 0) {
		container.createEl("h2", { text: "🔨 Tasks" });
		renderTaskTree(prunedTasks, container, app, 0, false, "tasks");
	}
}
