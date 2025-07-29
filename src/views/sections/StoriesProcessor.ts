import { App} from "obsidian";
import { TaskItem } from "../../types/TaskItem"; // Adjust path
import { renderTaskTree } from "../../components/TaskRenderer"; // Adjust path
import { processTaskType } from "../TaskTypeProcessor"; // Adjust path
import { isDirectlyAssigned, isSleeping } from "../../utils/taskFilters"; // Adjust path
import { findAncestor } from "../../utils/hierarchyUtils"; // Adjust path
import { getTaskType, isLearningEpic, isLearningInitiative } from "../../utils/taskTypes"; // Adjust path

export function processAndRenderStories(
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
	const isEpic = (t: TaskItem) =>
		t && (t.text.includes("🏆") || isLearningEpic(t));

	// Parent finders for stories
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
	];

	// Process stories
	const prunedStories = processTaskType(
		currentTasks,
		(task: TaskItem) =>
			isDirectlyAssigned(task) &&
			!isSleeping(task) &&
			getTaskType(task) === "story",
		parentFinders
	);

	// Render
	if (prunedStories.length > 0) {
		container.createEl("h2", { text: "📝 Stories" });
		renderTaskTree(prunedStories, container, app, 0, false, "stories");
	}
}
