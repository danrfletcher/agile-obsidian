import { App } from "obsidian";
import { TaskItem } from "../../types/TaskItem"; // Adjust path
import { renderTaskTree } from "../../components/TaskRenderer"; // Adjust path
import { processTaskType } from "../TaskTypeProcessor"; // Adjust path
import { isDirectlyAssigned, isSleeping } from "../../utils/taskFilters"; // Adjust path
import { findAncestor } from "../../utils/hierarchyUtils"; // Adjust path
import { getTaskType, isLearningInitiative } from "../../utils/taskTypes"; // Adjust path

export function processAndRenderEpics(
	container: HTMLElement,
	currentTasks: TaskItem[],
	status: boolean,
	app: App,
	taskMap: Map<string, TaskItem>,
	childrenMap: Map<string, TaskItem[]>
) {
	// Common type checks
	const isInitiative = (t: TaskItem) =>
		t && (t.text.includes("🎖️") || isLearningInitiative(t));

	// Parent finders for epics
	const parentFinders = [
		{
			finder: (t: TaskItem) => findAncestor(t, isInitiative),
			label: "initiative",
			typeCheck: isInitiative,
		},
	];

	// Process epics
	const prunedEpics = processTaskType(
		currentTasks,
		(task: TaskItem) =>
			isDirectlyAssigned(task) &&
			!isSleeping(task) &&
			getTaskType(task) === "epic",
		parentFinders
	);

	// Render
	if (prunedEpics.length > 0) {
		container.createEl("h2", { text: "🏆 Epics" });
		renderTaskTree(prunedEpics, container, app, 0, false, "epics");
	}
}
