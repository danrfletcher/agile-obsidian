import { App } from "obsidian";
import { TaskItem } from "../../types/TaskItem"; // Adjust path
import { renderTaskTree } from "../../components/TaskRenderer"; // Adjust path
import {
	activeForMember,
	isCancelled,
	isRelevantToday,
    isSleeping,
    teamMemberName,
} from "../../utils/taskFilters"; // Adjust path
import { isLearningEpic, isLearningInitiative } from "../../utils/taskTypes"; // Adjust path

export function processAndRenderInitiatives(
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
		t && (t.text.includes("🏆") || isLearningEpic(t)); // Assume isLearningEpic imported

	// Categorize epic (from original)
	const categorizeEpic = (epic: TaskItem) => {
		if (
			new RegExp(`class="(?:in)?active-(?!${teamMemberName})[^"]*"`).test(
				epic.text
			)
		)
			return "delegated";
		if (epic.text.includes(">⛔")) return "blocked";
		if (epic.text.includes(">⌛")) return "waiting";
		if (epic.text.includes(">🕒")) return "pending";
		if (epic.status === "/") return "inProgress";
		if (epic.status === " ") return "todo";
		return "other";
	};

	// Process own initiatives
	const ownInitiatives = currentTasks
		.filter((task) => task.text && isInitiative(task) && !isSleeping(task))
		.map((initiative) => {
			const epics = (
				childrenMap.get(initiative._uniqueId ?? "") || []
			).filter((ep) => isEpic(ep) && !ep.completed && !isCancelled(ep));
			const buckets: { [key: string]: TaskItem[] } = {
				inProgress: [],
				todo: [],
				blocked: [],
				waiting: [],
				pending: [],
				delegated: [],
				other: [],
			};
			epics
				.filter((ep) => !isSleeping(ep))
				.forEach((ep) => {
					const cat = categorizeEpic(ep);
					buckets[cat].push({ ...ep, children: [] });
				});
			const sorted: TaskItem[] = [];
			[
				"inProgress",
				"todo",
				"blocked",
				"waiting",
				"pending",
				"delegated",
				"other",
			].forEach((cat) => {
				if (buckets[cat].length) {
					if (cat !== "todo") sorted.push(...buckets[cat]);
				}
			});
			return { ...initiative, children: sorted };
		})
		.filter(
			(task) =>
				isInitiative(task) &&
				activeForMember(task, status) &&
				!task.completed &&
				isRelevantToday(task)
		)
		.sort((a, b) => {
			const aIsLearning = isLearningInitiative(a);
			const bIsLearning = isLearningInitiative(b);
			if (aIsLearning && !bIsLearning) return 1;
			if (!aIsLearning && bIsLearning) return -1;
			return 0;
		});

	// Render
	if (ownInitiatives.length > 0) {
		container.createEl("h2", { text: "🎖️ Initiatives" });
		renderTaskTree(ownInitiatives, container, app, 0, false, "initiatives");
	}
}
