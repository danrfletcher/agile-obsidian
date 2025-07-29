import { App } from "obsidian";
import { TaskItem } from "../../types/TaskItem"; // Adjust path
import { renderTaskTree } from "../../components/TaskRenderer"; // Adjust path
import { processTaskType } from "../TaskTypeProcessor"; // Adjust path
import {
	isDirectlyAssigned,
	isSleeping,
} from "../../utils/taskFilters"; // Adjust path
import { findAncestor } from "../../utils/hierarchyUtils"; // Adjust path
import { isLearningEpic, isLearningInitiative, isOKR } from "../../utils/taskTypes"; // Adjust path

export function processAndRenderTasks(
	container: HTMLElement,
	currentTasks: TaskItem[],
	status: boolean,
	app: App,
	taskMap: Map<string, TaskItem>,
	childrenMap: Map<string, TaskItem[]>
) {
	// Common type checks (shared across some sections)
	const isInitiative = (t: TaskItem) =>
		t && (t.text.includes("🎖️") || isLearningInitiative(t)); // Assume isLearningInitiative imported
	const isEpic = (t: TaskItem) =>
		t && (t.text.includes("🏆") || isLearningEpic(t)); // Assume isLearningEpic imported
	const isStory = (t: TaskItem) => t && t.text.includes("📝");

	// Parent finders for tasks
	const parentFinders = [
		{
			finder: (t: TaskItem) => findAncestor(t, isInitiative),
			label: "initiative",
			typeCheck: isInitiative,
		},
		{
			finder: (t: TaskItem) => findAncestor(t, isEpic),
			label: "epic",
			typeCheck: isEpic,
		},
		{
			finder: (t: TaskItem) => findAncestor(t, isStory),
			label: "story",
			typeCheck: isStory,
		},
	];

	// Process tasks using shared processTaskType
	const prunedTasks = processTaskType(
		currentTasks,
		(task: TaskItem) =>
			isDirectlyAssigned(task) &&
			!isInitiative(task) &&
			!isEpic(task) &&
			!isStory(task) &&
			!isOKR(task) &&
			!isSleeping(task) &&
			task.status !== "O" &&
			task.status !== "d" &&
			task.status !== "A",
		parentFinders
	);

	// Render if there are tasks
	if (prunedTasks.length > 0) {
		container.createEl("h2", { text: "🔨 Tasks" });
		renderTaskTree(prunedTasks, container, app, 0, false, "tasks");
	}
}
