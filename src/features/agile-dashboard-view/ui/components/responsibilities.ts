import { App, Component } from "obsidian";
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
	isScheduledForToday,
} from "@features/task-filter";
import { isRelevantToday } from "@features/task-date-manager";
import {
	buildHierarchyFromPath,
	getPathToAncestor,
	buildFullSubtree,
	findAncestor,
} from "@features/task-tree-builder";

/**
 * Process and render recurring Responsibilities assigned to the selected member/team.
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
	owner: Component
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

	const buildResponsibilitySubtree = (
		task: TaskItem,
		isRoot = false
	): TaskItem | null => {
		if (isSnoozed(task, taskMap, selectedAlias)) return null;

		const allowedMarkers = ["🚀", "📦", "⚡", "⭐", "💝", "🔁", "⬇️", "🪣"];
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
			.map((child: TaskItem) => buildResponsibilitySubtree(child, false))
			.filter((c): c is TaskItem => c !== null);

		if (task.task === false) {
			return children.length > 0 ? { ...task, children } : null;
		}

		const hasAllowed = hasAllowedMarker || hasAllowedStatus;
		const assignedToMeOrTeam = isAssignedToMemberOrTeam(
			task,
			selectedAlias
		);
		if (!hasAllowed && children.length === 0 && !assignedToMeOrTeam) {
			return null;
		}

		return { ...task, children };
	};

	const pruneToTargets = (
		node: TaskItem,
		targetIds: Set<string>,
		isUnderTarget = false
	): TaskItem | null => {
		if (!node) return null;

		const thisIsTarget = targetIds.has(node._uniqueId ?? "");
		const effectiveUnder = isUnderTarget || thisIsTarget;

		const prunedChildren = (node.children || [])
			.map((child: TaskItem) =>
				pruneToTargets(child, targetIds, effectiveUnder)
			)
			.filter((c): c is TaskItem => c !== null);

		if (effectiveUnder || prunedChildren.length > 0) {
			return { ...node, children: prunedChildren };
		}
		return null;
	};

	const trimUnassignedAncestors = (tree: TaskItem): TaskItem | null => {
		let current = tree;
		while (
			current &&
			current.children &&
			current.children.length === 1 &&
			!isAssignedToMemberIncludingInferred(current)
		) {
			current = current.children[0];
		}
		return current;
	};

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

	let allRecurring: TaskItem[] = [];
	priorityTrees.forEach((tree: TaskItem) =>
		collectRecurring(tree, allRecurring)
	);

	allRecurring = allRecurring.filter((task) => {
		const hasCalendar = /🗓️/.test(task.text);
		return !hasCalendar || isScheduledForToday(task);
	});

	const recurringWithSubtrees = allRecurring
		.map((rec) => {
			const subtree = buildResponsibilitySubtree(rec);
			return subtree ? { root: rec, subtree } : null;
		})
		.filter(
			(item): item is { root: TaskItem; subtree: TaskItem } =>
				item !== null
		);

	const responsibilityTreesMap = new Map<string, TaskItem>();
	recurringWithSubtrees.forEach(({ root: rec, subtree }) => {
		const topAncestor = findAncestor(rec, taskMap);
		if (!topAncestor || !topAncestor._uniqueId) return;
		const path = getPathToAncestor(rec, topAncestor._uniqueId, taskMap);
		if (!path || !path.length) return;

		const tree = buildHierarchyFromPath(path);
		if (!tree) return;

		let current: TaskItem = tree;
		for (let i = 1; i < path.length; i++) {
			current = current.children[0];
		}
		current.children = subtree.children || [];

		const prunedTree = pruneToTargets(tree, new Set([rec._uniqueId ?? ""]));
		if (!prunedTree) return;

		const trimmedTree = trimUnassignedAncestors(prunedTree);
		if (!trimmedTree) return;

		const rootId = trimmedTree._uniqueId ?? "";
		if (!responsibilityTreesMap.has(rootId)) {
			responsibilityTreesMap.set(rootId, trimmedTree);
		} else {
			const existing = responsibilityTreesMap.get(rootId);
			if (!existing) return;
			trimmedTree.children.forEach((newChild: TaskItem) => {
				const match = existing.children.find(
					(c: TaskItem) => c._uniqueId === newChild._uniqueId
				);
				if (match) {
					match.children = [
						...new Set([...match.children, ...newChild.children]),
					];
				} else {
					existing.children.push(newChild);
				}
			});
		}
	});

	const responsibilityTasks = Array.from(responsibilityTreesMap.values());

	const responsibilityTasksParamFilter = responsibilityTasks.filter(
		(task) => {
			return (
				(inProgress && isInProgress(task, taskMap, selectedAlias)) ||
				(completed && isCompleted(task)) ||
				(sleeping && isSnoozed(task, taskMap, selectedAlias)) ||
				(cancelled && isCancelled(task))
			);
		}
	);

	if (responsibilityTasksParamFilter.length > 0 && status) {
		container.createEl("h2", { text: "🧹 Responsibilities" });
		renderTaskTree(
			responsibilityTasksParamFilter,
			container,
			owner,
			app,
			0,
			false,
			"responsibilities",
			selectedAlias
		);
	}
}
