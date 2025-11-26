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
	isAssignedToMemberOrTeam,
	isAssignedToAnyUser,
} from "@features/task-filter";
import { isRelevantToday, recurringPatternMatchesToday } from "@features/task-date-manager";
import { buildFullSubtree } from "@features/task-tree-builder";
import { attachSectionFolding } from "@features/task-tree-fold";

type RegisterDomEvent = (
	el: HTMLElement | Window | Document,
	type: string,
	handler: (evt: Event) => void,
	options?: AddEventListenerOptions | boolean
) => void;

/**
Process and render recurring Responsibilities assigned to the selected member/team.

New behavior:
- Show only the responsibility itself (no pre-expanded children).
- Add fold/unfold on the responsibility item to reveal its children.
- We DO NOT fold away higher-level ancestors in its task tree.
*/
export function processAndRenderResponsibilities(
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
	void childrenMap;

	const { inProgress, completed, sleeping, cancelled } = taskParams;

	const isAssignedToMemberIncludingInferred = (task: TaskItem) => {
		if (isAssignedToMemberOrTeam(task, selectedAlias)) return true;

		let cur: TaskItem | undefined = task;
		while (cur?._parentId) {
			const parentId = cur._parentId;
			if (!parentId) return false;
			cur = taskMap.get(parentId);
			if (!cur) return false;

			if (isAssignedToAnyUser(cur)) {
				return activeForMember(cur, status, selectedAlias);
			}
		}
		return false;
	};

	const collectRecurring = (node: TaskItem, collector: TaskItem[]) => {
		if (
			getAgileArtifactType(node) === "recurring-responsibility" &&
			isAssignedToMemberIncludingInferred(node) &&
			!isSnoozed(node, taskMap, selectedAlias)
		) {
			collector.push(node);
		}
		(node.children || []).forEach((child: TaskItem) =>
			collectRecurring(child, collector)
		);
	};

	// Identify relevant roots (top-down priorities filter, as before)
	const priorityRoots = currentTasks.filter(
		(task) =>
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

	const priorityTrees = priorityRoots.map((t) => buildFullSubtree(t));

	// Gather recurring responsibilities present in the subtree of today's relevant items
	let allRecurring: TaskItem[] = [];
	priorityTrees.forEach((tree: TaskItem) =>
		collectRecurring(tree, allRecurring)
	);

	// Respect DOW schedules like "🗓️ Sundays"
	allRecurring = allRecurring.filter((task) => {
		const hasCalendar = /🗓️/.test(task.text);
		return !hasCalendar || recurringPatternMatchesToday(task);
	});

	// Unique by _uniqueId
	const seen = new Set<string>();
	const uniqueRecurring: TaskItem[] = [];
	for (const r of allRecurring) {
		const id = r._uniqueId ?? "";
		if (!id || seen.has(id)) continue;
		seen.add(id);
		uniqueRecurring.push(r);
	}

	// Apply status filters to the responsibility itself (no children considered here)
	const responsibilityItemsFiltered = uniqueRecurring.filter((task) => {
		return (
			(inProgress && isInProgress(task, taskMap, selectedAlias)) ||
			(completed && isCompleted(task)) ||
			(sleeping && isSnoozed(task, taskMap, selectedAlias)) ||
			(cancelled && isCancelled(task))
		);
	});

	if (responsibilityItemsFiltered.length > 0 && status) {
		container.createEl("h2", { text: "🧹 Responsibilities" });

		// Render just the responsibility items themselves (no pre-rendered children)
		const shallowOnly = responsibilityItemsFiltered.map((t) => ({
			...t,
			children: [],
		}));
		renderTaskTree(
			shallowOnly,
			container,
			app,
			0,
			false,
			"responsibilities",
			selectedAlias
		);

		// Enable folding on these bottom-level responsibility items
		try {
			attachSectionFolding(container, {
				app,
				taskMap,
				childrenMap,
				selectedAlias,
				renderTaskTree,
				registerDomEvent,
				sectionName: "responsibilities",
			});
		} catch {
			/* ignore */
		}
	}
}
