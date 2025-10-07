import { App } from "obsidian";
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
import { isRelevantToday } from "@features/task-date-manager";
import { stripListItems } from "@features/task-tree-builder";
import { attachSectionFolding } from "@features/task-tree-fold";

type RegisterDomEvent = (
	el: HTMLElement | Window | Document,
	type: string,
	handler: (evt: any) => void,
	options?: AddEventListenerOptions | boolean
) => void;

/**
Process and render the Priorities section (time-relevant task trees).
New: Enable folding on bottom-level items to allow further subtasks expansion.
*/
export function processAndRenderPriorities(
	container: HTMLElement,
	currentTasks: TaskItem[],
	status: boolean,
	selectedAlias: string | null,
	app: App,
	taskMap: Map<string, TaskItem>,
	childrenMap: Map<string, TaskItem[]>,
	taskParams: TaskParams,
	registerDomEvent?: RegisterDomEvent
) {
	const { inProgress, completed, sleeping, cancelled } = taskParams;

	const buildPriorityTree = (
		task: TaskItem,
		isRoot = false
	): TaskItem | null => {
		if (isSnoozed(task, taskMap, selectedAlias)) return null;

		const allowedMarkers = ["🚀", "📦", "⚡", "⭐", "💝", "⬇️", "🪣"];
		const disallowedMarkers = ["❌", "🛠️", "📂", "🏆", "📝", "🎖️"];

		if (disallowedMarkers.some((m) => task.text.includes(m))) return null;
		if (
			getAgileArtifactType(task) === "learning-initiative" ||
			getAgileArtifactType(task) === "learning-epic"
		)
			return null;

		const hasAllowedMarker = allowedMarkers.some((m) =>
			task.text.includes(m)
		);
		const hasAllowedStatus = task.status === "d" || task.status === "A";

		if (!isRoot && !hasAllowedMarker && !hasAllowedStatus) return null;

		const children = (task.children || [])
			.map((child: TaskItem) => buildPriorityTree(child, false))
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

	const priorityRoots = currentTasks.filter(
		(task: TaskItem) =>
			task.status === "O" &&
			!task.completed &&
			isRelevantToday(task) &&
			!isCancelled(task) &&
			!task.text.includes("🎖️") &&
			!task.text.includes("🏆") &&
			!task.text.includes("📝") &&
			!isSnoozed(task, taskMap, selectedAlias) &&
			getAgileArtifactType(task) !== "recurring-responsibility"
	);

	const rawTreesPriorities = priorityRoots
		.map((task: TaskItem) => buildPriorityTree(task, true))
		.filter((tree): tree is TaskItem => tree !== null);

	const prunePriorities = (
		node: TaskItem,
		inherited = false
	): TaskItem | null => {
		const assignedToSelected = activeForMember(node, status, selectedAlias);
		const isInherited = inherited || assignedToSelected;
		const children = (node.children || [])
			.map((child: TaskItem) => prunePriorities(child, isInherited))
			.filter((c): c is TaskItem => c !== null);
		if (isInherited || children.length > 0) {
			return { ...node, children };
		}
		return null;
	};

	const priorityTasks = rawTreesPriorities
		.map((tree: TaskItem) => prunePriorities(tree))
		.filter((tree): tree is TaskItem => tree !== null)
		.filter((tree: TaskItem) => {
			if (!selectedAlias) return true;
			const isSelected = activeForMember(tree, status, selectedAlias);
			return isSelected || (tree.children?.length ?? 0) > 0;
		});

	const strippedPriorityTasks = stripListItems(priorityTasks);

	const filteredPriorityTasks = strippedPriorityTasks.filter((task) => {
		return (
			(inProgress && isInProgress(task, taskMap, selectedAlias)) ||
			(completed && isCompleted(task)) ||
			(sleeping && isSnoozed(task, taskMap, selectedAlias)) ||
			(cancelled && isCancelled(task))
		);
	});

	if (filteredPriorityTasks.length > 0 && status) {
		container.createEl("h2", { text: "📂 Priorities" });
		renderTaskTree(
			filteredPriorityTasks,
			container,
			app,
			0,
			false,
			"priorities",
			selectedAlias
		);

		// Add folding for bottom-level items
		try {
			attachSectionFolding(container, {
				app,
				taskMap,
				childrenMap,
				selectedAlias,
				renderTaskTree,
				registerDomEvent,
				sectionName: "priorities",
			});
		} catch {
			/* ignore */
		}
	}
}
