import { App } from "obsidian";
import { TaskItem, TaskParams } from "../../types/TaskItem"; // Adjust path
import { renderTaskTree } from "../../components/TaskRenderer"; // Adjust path
import {
	activeForMember,
	isCancelled,
	isSleeping,
} from "../../utils/taskFilters"; // Adjust path (added name)
import {
	isRecurringResponsibility,
	isLearningInitiative,
	isLearningEpic,
} from "../../utils/taskTypes"; // Adjust path
import { isRelevantToday } from "../../utils/dateUtils";
import { getTeamMemberSlug } from "../../utils/snooze";
import { stripListItems } from "../../utils/hierarchyUtils";

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function processAndRenderPriorities(
	container: HTMLElement,
	currentTasks: TaskItem[],
	status: boolean,
	app: App,
	taskMap: Map<string, TaskItem>,
	childrenMap: Map<string, TaskItem[]>,
	taskParams: TaskParams
) {
	const userSlug = getTeamMemberSlug();
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
		const assignedToMe = activeForMember(task);
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
		// If no user slug, don't filter by assignment
		const assignedToMe = userSlug
			? new RegExp(`\\bactive-${escapeRegex(userSlug)}\\b`, "i").test(
					node.text
		) &&
			!new RegExp(`\\binactive-${escapeRegex(userSlug)}\\b`, "i").test(
					node.text
		)
			: true;

		const isInherited = inherited || assignedToMe;
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
			if (!userSlug) return true;
			const isMe =
				new RegExp(`\\bactive-${escapeRegex(userSlug)}\\b`, "i").test(
					tree.text
				) &&
				!new RegExp(
					`\\binactive-${escapeRegex(userSlug)}\\b`,
					"i"
				).test(tree.text);
			return isMe || (tree.children?.length ?? 0) > 0; // Safe default
		});
	console.log("⚡ ~ priorityTasks:", priorityTasks);

	const strippedPriorityTasks = stripListItems(priorityTasks);

	// Render
	if (strippedPriorityTasks.length > 0) {
		container.createEl("h2", { text: "📂 Priorities" });
		renderTaskTree(strippedPriorityTasks, container, app, 0, false, "priorities");
	}
}
