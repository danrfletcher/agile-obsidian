import { App, Component } from "obsidian";
import { TaskItem, TaskParams } from "@features/task-index";
import { renderTaskTree } from "./task-renderer";
import { activeForMember, getAgileArtifactType } from "@features/task-filter";
import { buildPrunedMergedTrees } from "@features/task-tree-builder";
import { isShownByParams } from "../utils/filters";

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
	const sectionTasks = currentTasks.filter((task) =>
		isShownByParams(task, taskMap, selectedAlias, taskParams)
	);

	const assignedOKRs = sectionTasks.filter(
		(task) =>
			getAgileArtifactType(task) === "okr" &&
			activeForMember(task, status, selectedAlias)
	);
	const assignedOKRSet = new Set(assignedOKRs.map((t) => t._uniqueId ?? ""));

	const findLinkedOKRs = (okrSet: Set<string>) => {
		const linkedOKRs: { _uniqueId: string; linkedTasks: TaskItem[] }[] = [];
		const assignedOKRIds = Array.from(okrSet);

		assignedOKRIds.forEach((okrId) => {
			const okrTask = taskMap.get(okrId);
			if (!okrTask) return;

			const sixDigitCode = okrTask.blockId;
			if (!sixDigitCode || !/^[A-Za-z0-9]{6}$/.test(sixDigitCode)) {
				return;
			}

			const linkedPattern = new RegExp(`${sixDigitCode}">🔗🎯`);
			const rawLinked = sectionTasks.filter((t) =>
				linkedPattern.test(t.text)
			);
			if (!rawLinked.length) return;
			linkedOKRs.push({ _uniqueId: okrId, linkedTasks: rawLinked });
		});

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
				app,
				0,
				false,
				"objectives-linked",
				selectedAlias
			);
		});
	}
}
