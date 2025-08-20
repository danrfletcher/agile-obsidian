import { App } from "obsidian";
import { TaskItem, TaskParams } from "../../types/TaskItem"; // Adjust path
import { renderTaskTree } from "../../components/TaskRenderer"; // Adjust path
import {
	activeForMember,
	isCancelled,
	isInProgress,
	isMarkedCompleted,
	isSleeping,
} from "../../utils/tasks/taskFilters"; // Adjust path (added name)
import {
	isRecurringResponsibility,
	isLearningInitiative,
	isLearningEpic,
} from "../../utils/tasks/taskTypes"; // Adjust path
import { isRelevantToday } from "../../utils/dates/dateUtils";
import { stripListItems } from "../../utils/hierarchy/hierarchyUtils";


export function processAndRenderPriorities(
	container: HTMLElement,
	currentTasks: TaskItem[],
	status: boolean,
	selectedAlias: string | null,
	app: App,
	taskMap: Map<string, TaskItem>,
	childrenMap: Map<string, TaskItem[]>,
	taskParams: TaskParams
) {
	// Filter for task params
	const { inProgress, completed, sleeping, cancelled } = taskParams;

	// Priorities logic (extracted)
	const buildPriorityTree = (
		task: TaskItem,
		isRoot = false
	): TaskItem | null => {
		if (isSleeping(task, taskMap)) return null;

		const allowedMarkers = ["🚀", "📦", "⚡", "⭐", "💝", "⬇️", "🪣"];
		const disallowedMarkers = ["❌", "🛠️", "📂", "🏆", "📝", "🎖️"];

		if (disallowedMarkers.some((m) => task.text.includes(m))) return null;

		if (isLearningInitiative(task) || isLearningEpic(task)) return null;

		const hasAllowedMarker = allowedMarkers.some((m) =>
			task.text.includes(m)
		);
		const hasAllowedStatus = task.status === "d" || task.status === "A";

		if (!isRoot && !hasAllowedMarker && !hasAllowedStatus) return null;

		const children = (task.children || [])
			.map((child: TaskItem) => buildPriorityTree(child, false)) // Typed parameter
			.filter((c): c is TaskItem => c !== null);

		if (task.task === false) {
			return children.length > 0 ? { ...task, children } : null;
		}

		const hasAllowed = hasAllowedMarker || hasAllowedStatus;
		const assignedToMe = activeForMember(task, status, selectedAlias);
		if (!hasAllowed && children.length === 0 && !assignedToMe) {
			return null;
		}

		return { ...task, children };
	};

	// Define priorityRoots (missing from original extract; replicated from ResponsibilitiesProcessor logic)
	const priorityRoots = currentTasks.filter(
		(
			task: TaskItem // Typed parameter
		) =>
			task.status === "O" &&
			!task.completed &&
			isRelevantToday(task) &&
			!isCancelled(task) &&
			!task.text.includes("🎖️") &&
			!task.text.includes("🏆") &&
			!task.text.includes("📝") &&
			!isSleeping(task, taskMap) &&
			!isRecurringResponsibility(task)
	);

	const rawTreesPriorities = priorityRoots
		.map((task: TaskItem) => buildPriorityTree(task, true)) // Typed parameter
		.filter((tree): tree is TaskItem => tree !== null); // Type guard already handles this

	const prunePriorities = (
		node: TaskItem,
		inherited = false
	): TaskItem | null => {
		const assignedToSelected = activeForMember(node, status, selectedAlias);
		const isInherited = inherited || assignedToSelected;
		const children = (node.children || [])
			.map((child: TaskItem) => prunePriorities(child, isInherited)) // Typed parameter
			.filter((c): c is TaskItem => c !== null);
		if (isInherited || children.length > 0) {
			return { ...node, children };
		}
		return null;
	};

	const priorityTasks = rawTreesPriorities
		.map((tree: TaskItem) => prunePriorities(tree)) // Typed parameter
		.filter((tree): tree is TaskItem => tree !== null) // Type guard
		.filter((tree: TaskItem) => {
			if (!selectedAlias) return true;
			const isSelected = activeForMember(tree, status, selectedAlias);
			return isSelected || (tree.children?.length ?? 0) > 0; // Safe default
		});

	const strippedPriorityTasks = stripListItems(priorityTasks);

	const filteredPriorityTasks = strippedPriorityTasks.filter((task) => {
		return (
			(inProgress && isInProgress(task, taskMap)) ||
			(completed && isMarkedCompleted(task)) ||
			(sleeping && isSleeping(task, taskMap)) ||
			(cancelled && isCancelled(task))
		);
	});

	// Render
	// TO DO: enable inactive priorities in inactive project view ⚓ ^365034
	if (filteredPriorityTasks.length > 0 && status) {
		container.createEl("h2", { text: "📂 Priorities" });
		renderTaskTree(
			filteredPriorityTasks,
			container,
			app,
			0,
			false,
			"priorities"
		);
	}
}
