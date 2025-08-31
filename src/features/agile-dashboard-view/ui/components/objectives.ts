import { App } from "obsidian";
import { TaskItem, TaskParams } from "src/features/tasks/task-item";
import { renderTaskTree } from "./task-renderer";
import {
	activeForMember,
	isCancelled,
	isInProgress,
	isMarkedCompleted,
	isSleeping,
} from "src/features/agile-dashboard-view/domain/task-filters";
import { buildPrunedMergedTrees } from "src/features/agile-dashboard-view/domain/hierarchy-utils";
import { isOKR } from "src/features/agile-dashboard-view/domain/task-types";

export function processAndRenderObjectives(
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
	const sectionTasks = currentTasks.filter((task) => {
		return (
			(inProgress && isInProgress(task, taskMap)) ||
			(completed && isMarkedCompleted(task)) ||
			(sleeping && isSleeping(task, taskMap)) ||
			(cancelled && isCancelled(task))
		);
	});

	// Fetch OKRs for current user
	const assignedOKRs = sectionTasks.filter(
		(task) => isOKR(task) && activeForMember(task, status, selectedAlias)
	);
	const assignedOKRSet = new Set(assignedOKRs.map((t) => t._uniqueId ?? "")); // Guarded

	// Fetch tasks linked to user's OKRs
	const findLinkedOKRs = (okrSet: Set<string>) => {
		const linkedOKRs: { _uniqueId: string; linkedTasks: TaskItem[] }[] = [];
		const assignedOKRIds = Array.from(okrSet);

		assignedOKRIds.forEach((okrId) => {
			const okrTask = taskMap.get(okrId);
			if (!okrTask) return;

			const sixDigitCode = okrTask.blockId;
			if (!sixDigitCode || !/^[A-Za-z0-9]{6}$/.test(sixDigitCode)) {
				console.warn(
					`Invalid or missing blockId for OKR: ${okrTask.text}`
				);
				return;
			}

			// Pattern to detect links in task.text
			const linkedPattern = new RegExp(`${sixDigitCode}">🔗🎯`);

			// Grab linked tasks
			const rawLinked = currentTasks.filter((t) =>
				linkedPattern.test(t.text)
			);
			if (!rawLinked.length) return;
			linkedOKRs.push({
				_uniqueId: okrId,
				linkedTasks: rawLinked,
			});
		});

		return linkedOKRs;
	};
	const linkedOKRs = findLinkedOKRs(assignedOKRSet);

	// Process linked tasks into pruned merged trees
	const prunedOKRs = linkedOKRs
		.map((entry) => {
			const okr = taskMap.get(entry._uniqueId);
			if (!okr) {
				console.warn(`No OKR task found for ID: ${entry._uniqueId}`);
				return null; // Skip if not found
			}
			const linkedTrees = buildPrunedMergedTrees(
				entry.linkedTasks,
				taskMap
			);

			// Create a Set of original linkedTask _uniqueIds for quick matching
			const linkedIds = new Set(
				entry.linkedTasks.map((t) => t._uniqueId ?? "")
			);

			// DFS helper to traverse and modify matching leaves in place
			const updateStatusDFS = (node: TaskItem) => {
				if (linkedIds.has(node._uniqueId ?? "")) {
					node.status = "p"; // Set status to 'p' for matching original linked tasks

					// Regenerate visual to reflect the new status (replace old status marker)
					if (node.visual) {
						// Assumes visual starts with "- [oldStatus] " — adjust regex if your format differs
						node.visual = node.visual.replace(
							/-\s*\[\s*.\s*\]/, // Matches "- [ ]", "- [/]", etc.
							"- [p]" // Replace with "- [p]"
						);
					}
				}
				node.children?.forEach((child) => updateStatusDFS(child)); // Recurse depth-first
			};

			// Apply DFS to each tree
			linkedTrees.forEach((tree) => updateStatusDFS(tree));

			// Helper to collect all leaves (nodes with no children) from a tree
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

			// Helper to get priority for a tree based on leaf assignments
			const getTreePriority = (tree: TaskItem): number => {
				const leaves = getTreeLeaves(tree);
				const hasActive = leaves.some((leaf) =>
					activeForMember(leaf, true)
				);
				if (hasActive) return 1; // Highest: Any active

				const hasInactive = leaves.some((leaf) =>
					activeForMember(leaf, false)
				);
				if (hasInactive) return 2; // Medium: Only inactive (no actives)

				return 3; // Lowest: Only unassigned
			};

			// Sort linkedTrees by priority (1 first, then 2, then 3; stable for ties)
			linkedTrees.sort((a, b) => getTreePriority(a) - getTreePriority(b));

			return { okr, linkedTrees };
		})
		.filter(
			(item): item is { okr: TaskItem; linkedTrees: TaskItem[] } =>
				item !== null
		);

	// Render if there are tasks (with header)
	// TO DO: limit number of OKRs displayed per person to 1: all other OKRs are considered future OKRs & are inactive - displayed when status (active/inactive toggle is inactive/false) ⚓ ^efa4fb
	if (prunedOKRs.length > 0 && status) {
		container.createEl("h2", { text: "🎯 Objectives" });

		prunedOKRs.forEach(({ okr, linkedTrees }) => {
			// 1. Render the full OKR including all of its children
			renderTaskTree([okr], container, app, 0, false, "objectives");

			// 2. Render the "Linked Items" subheader with level-1 indentation (inline margin)
			container.createEl("h5", {
				text: "🔗 Linked Items",
				attr: {
					style: "margin-left: 20px;", // Matches one level of subtask indentation (adjust if needed)
				},
			});

			// 3. Render every linkedTree sequentially including all children (already pruned), indented by 1 level
			const indentedWrapper = container.createEl("div", {
				attr: {
					style: "padding-left: 20px;", // Indents the entire block like a level-1 subtask
				},
			});
			renderTaskTree(
				linkedTrees,
				indentedWrapper,
				app,
				0,
				false,
				"objectives"
			);
		});
	}
}
