import { App } from "obsidian";
import { TaskItem } from "../../types/TaskItem"; // Adjust path
import { renderTaskTree } from "../../components/TaskRenderer"; // Adjust path
import {
	isAssignedToMemberOrTeam,
	isAssignedToAnyUser,
	activeForMember,
	isSleeping,
    isRelevantToday,
    isCancelled,
} from "../../utils/taskFilters"; // Adjust path
import {
	getTopAncestor,
	getPathToAncestor,
	buildHierarchyFromPath,
	buildFullSubtree,
} from "../../utils/hierarchyUtils"; // Adjust path
import {
	isRecurringResponsibility,
	isLearningInitiative,
	isLearningEpic,
} from "../../utils/taskTypes"; // Adjust path
import { matchesDatePattern } from "../../utils/dateUtils"; // Adjust path

export function processAndRenderResponsibilities(
	container: HTMLElement,
	currentTasks: TaskItem[],
	status: boolean,
	app: App,
	taskMap: Map<string, TaskItem>,
	childrenMap: Map<string, TaskItem[]>
) {
	// Responsibilities logic (extracted)
	const isAssignedToMemberIncludingInferred = (task: TaskItem) => {
		if (isAssignedToMemberOrTeam(task)) return true;
		let cur: TaskItem | undefined = task;
		while (cur?._parentId) {
			const parentId = cur._parentId;
			if (!parentId) return false; // Guard
			cur = taskMap.get(parentId);
			if (!cur) return false;
			if (isAssignedToAnyUser(cur)) {
				return activeForMember(cur);
			}
		}
		return false;
	};

	const collectRecurring = (node: TaskItem, collector: TaskItem[]) => {
		if (
			isRecurringResponsibility(node) &&
			isAssignedToMemberIncludingInferred(node) &&
			!isSleeping(node)
		) {
			collector.push(node);
		}
		(node.children || []).forEach((child) =>
			collectRecurring(child, collector)
		);
	};

	const buildResponsibilitySubtree = (
		task: TaskItem,
		isRoot = false
	): TaskItem | null => {
		if (isSleeping(task)) return null;

		const allowedMarkers = ["🚀", "📦", "⚡", "⭐", "💝", "🔁", "⬇️", "🪣"];
		const disallowedMarkers = ["❌", "🛠️", "📂", "🏆", "📝", "🎖️"];

		if (disallowedMarkers.some((m) => task.text.includes(m))) return null;

		if (isLearningInitiative(task) || isLearningEpic(task)) return null;

		const hasAllowedMarker = allowedMarkers.some((m) =>
			task.text.includes(m)
		);
		const hasAllowedStatus = task.status === "d" || task.status === "A";

		if (!isRoot && !hasAllowedMarker && !hasAllowedStatus) return null;

		const children = (task.children || [])
			.map((child) => buildResponsibilitySubtree(child, false))
			.filter((c): c is TaskItem => c !== null);

		if (task.task === false) {
			return children.length > 0 ? { ...task, children } : null;
		}

		const hasAllowed = hasAllowedMarker || hasAllowedStatus;
		const assignedToMeOrTeam = isAssignedToMemberOrTeam(task);
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
			.map((child) => pruneToTargets(child, targetIds, effectiveUnder))
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
			!isSleeping(task) &&
			!isRecurringResponsibility(task)
	);

	const priorityTrees = priorityRoots.map(buildFullSubtree);

	let allRecurring: TaskItem[] = [];
	priorityTrees.forEach((tree) => collectRecurring(tree, allRecurring));

	allRecurring = allRecurring.filter(
		(task) => !/🗓️/.test(task.text) || matchesDatePattern(task)
	);

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
		const topAncestorId = getTopAncestor(rec)._uniqueId ?? "";
		const path = getPathToAncestor(rec, topAncestorId);
		if (!path.length) return;

		const tree = buildHierarchyFromPath(path);
		if (!tree) return;

		let current = tree;
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
			if (!existing) return; // Guard
			trimmedTree.children.forEach((newChild) => {
				const match = existing.children.find(
					(c) => c._uniqueId === newChild._uniqueId
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

	// Render
	if (responsibilityTasks.length > 0) {
		container.createEl("h2", { text: "🧹 Responsibilities" });
		renderTaskTree(
			responsibilityTasks,
			container,
			app,
			0,
			false,
			"responsibilities"
		);
	}
}
