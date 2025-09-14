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

	// Loosen constraints: accept any non-whitespace block id (letters, digits, dashes/underscores allowed)
	// but we'll just escape exactly the given blockId and search for anchor matches.
	const e = escapeRegExp(blockId);

	// Support:
	// - Wiki links: [[...#^blockId|...🔗🎯...]]
	// - Markdown links: [🔗🎯](...#^blockId) or [something with 🔗🎯](...#^blockId)
	// - Fallback HTML-ish: '#^blockId"...🔗🎯' if raw HTML ends up in text
	const patterns = [
		// Wiki link with optional alias that includes the marker
		new RegExp(`\\[\\[[^\\]]*#\\^${e}(?:\\|[^\\]]*🔗\\s*🎯[^\\]]*)?\\]\\]`),
		// Markdown link with marker text and anchor
		new RegExp(`\\[[^\\]]*🔗\\s*🎯[^\\]]*\\]\\([^\\)]*#\\^${e}[^\\)]*\\)`),
		// Very loose: an anchor occurrence followed by marker in same chunk
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
	taskParams: TaskParams
) {
	const { inProgress, completed, sleeping, cancelled } = taskParams;

	// Apply status visibility filters to the universe we consider
	const sectionTasks = currentTasks.filter((task) => {
		return (
			(inProgress && isInProgress(task, taskMap)) ||
			(completed && isCompleted(task)) ||
			(sleeping && isSnoozed(task, taskMap)) ||
			(cancelled && isCancelled(task))
		);
	});

	// Find OKRs assigned/active for the selected member
	const assignedOKRs = sectionTasks.filter(
		(task) =>
			getAgileArtifactType(task) === "okr" &&
			activeForMember(task, status, selectedAlias)
	);

	// Build entries for all assigned OKRs (linked items are optional)
	const okrEntries = assignedOKRs
		.map((okr) => {
			const linkedTasks = findLinkedTasksForOKR(okr, currentTasks);

			// Build merged/pruned trees for linked tasks (may be empty)
			const linkedTrees = buildPrunedMergedTrees(linkedTasks, taskMap);

			// Mark directly-linked items as "p" (planned/in-progress) within the linked subtrees
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

			// Sort linked trees by priority:
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

	// Only render the section when:
	// - there are OKRs to show, and
	// - the "Active/Inactive" toggle allows it (status)
	if (okrEntries.length > 0 && status) {
		container.createEl("h2", { text: "🎯 Objectives" });

		okrEntries.forEach(({ okr, linkedTrees }) => {
			// Render the OKR itself
			renderTaskTree(
				[okr],
				container,
				app,
				0,
				false,
				"objectives",
				selectedAlias
			);

			// Render linked items only if any exist
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
