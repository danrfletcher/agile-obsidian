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
} from "@features/task-filter";
import { buildPrunedMergedTrees } from "@features/task-tree-builder";
import { escapeRegExp } from "@utils";

/**
 * Given an OKR task, find tasks that link to it using the 🔗🎯 marker.
 * Works with or without a blockId. If no blockId is present, we don't attempt
 * to match by anchor — we simply return an empty list (OKR will still render).
 */
function findLinkedTasksForOKR(
	okrTask: TaskItem,
	currentTasks: TaskItem[]
): TaskItem[] {
	const textOf = (t: TaskItem) => t.text || t.visual || "";

	const blockIdRaw = (okrTask as any)?.blockId as string | undefined;
	const blockId = (blockIdRaw || "").trim();

	if (!blockId) {
		// No blockId: do not try to infer links; return none.
		return [];
	}

	const e = escapeRegExp(blockId);

	const patterns = [
		new RegExp(`\\[\\[[^\\]]*#\\^${e}(?:\\|[^\\]]*🔗\\s*🎯[^\\]]*)?\\]\\]`),
		new RegExp(`\\[[^\\]]*🔗\\s*🎯[^\\]]*\\]\\([^\\)]*#\\^${e}[^\\)]*\\)`),
		new RegExp(`#\\^${e}[^\\n]*🔗\\s*🎯`),
	];

	return currentTasks.filter((t) => {
		const s = textOf(t);
		if (!s) return false;
		return patterns.some((re) => re.test(s));
	});
}

/**
 * Process and render Objectives (OKRs) and their linked item trees.
 */
export function processAndRenderObjectives(
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
	const { inProgress, completed, sleeping, cancelled } = taskParams;

	const sectionTasks = currentTasks.filter((task) => {
		return (
			(inProgress && isInProgress(task, taskMap)) ||
			(completed && isCompleted(task)) ||
			(sleeping && isSnoozed(task, taskMap)) ||
			(cancelled && isCancelled(task))
		);
	});

	const assignedOKRs = sectionTasks.filter(
		(task) =>
			getAgileArtifactType(task) === "okr" &&
			activeForMember(task, status, selectedAlias)
	);

	const okrEntries = assignedOKRs
		.map((okr) => {
			const linkedTasks = findLinkedTasksForOKR(okr, currentTasks);
			const linkedTrees = buildPrunedMergedTrees(linkedTasks, taskMap);

			const linkedIds = new Set(
				linkedTasks.map((t) => t._uniqueId ?? "")
			);
			const updateStatusDFS = (node: TaskItem) => {
				if (linkedIds.has(node._uniqueId ?? "")) {
					node.status = "p";
					if (node.visual) {
						node.visual = node.visual.replace(
							/-\s*\[\s*.\s*\]/,
							"- [p]"
						);
					}
				}
				node.children?.forEach((child) => updateStatusDFS(child));
			};
			linkedTrees.forEach((tree) => updateStatusDFS(tree));

			const getTreeLeaves = (
				node: TaskItem,
				leaves: TaskItem[] = []
			): TaskItem[] => {
				if (!node.children || node.children.length === 0) {
					leaves.push(node);
				} else {
					node.children.forEach((child) =>
						getTreeLeaves(child, leaves)
					);
				}
				return leaves;
			};
			const getTreePriority = (tree: TaskItem): number => {
				const leaves = getTreeLeaves(tree);
				const hasActive = leaves.some((leaf) =>
					activeForMember(leaf, true)
				);
				if (hasActive) return 1;
				const hasInactive = leaves.some((leaf) =>
					activeForMember(leaf, false)
				);
				if (hasInactive) return 2;
				return 3;
			};
			linkedTrees.sort((a, b) => getTreePriority(a) - getTreePriority(b));

			return { okr, linkedTrees };
		})
		.filter(
			(item): item is { okr: TaskItem; linkedTrees: TaskItem[] } =>
				item.okr != null
		);

	if (okrEntries.length > 0 && status) {
		container.createEl("h2", { text: "🎯 Objectives" });

		okrEntries.forEach(({ okr, linkedTrees }) => {
			renderTaskTree(
				[okr],
				container,
				owner,
				app,
				0,
				false,
				"objectives",
				selectedAlias
			);

			if (linkedTrees.length > 0) {
				container.createEl("h5", {
					text: "🔗 Linked Items",
					attr: { style: "margin-left: 20px;" },
				});
				const indentedWrapper = container.createEl("div", {
					attr: { style: "padding-left: 20px;" },
				});
				renderTaskTree(
					linkedTrees,
					indentedWrapper,
					owner,
					app,
					0,
					false,
					"objectives",
					selectedAlias
				);
			}
		});
	}
}
