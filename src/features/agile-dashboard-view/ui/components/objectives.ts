import { App } from "obsidian";
import { TaskItem, TaskParams } from "@features/task-index";
import { renderTaskTree } from "./task-renderer";
import { activeForMember, getAgileArtifactType } from "@features/task-filter";
import { buildPrunedMergedTrees } from "@features/task-tree-builder";
import { isShownByParams } from "../utils/filters";
import { attachSectionFolding } from "@features/task-tree-fold";

type RegisterDomEvent = (
	el: HTMLElement | Window | Document,
	type: string,
	handler: (evt: any) => void,
	options?: AddEventListenerOptions | boolean
) => void;

/**
Process and render Objectives (OKRs) and their linked item trees.
Folding behavior:
- Render objectives (OKRs) without their native children, and enable fold/unfold on the OKR itself.
- In the "Linked Items" section, only add fold toggles on bottom-level items currently displayed.
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
	registerDomEvent?: RegisterDomEvent
) {
	const sectionTasks = currentTasks.filter((task) =>
		isShownByParams(task, taskMap, selectedAlias, taskParams)
	);

	// Assigned OKRs to the selected member (active assignment only)
	const assignedOKRs = sectionTasks.filter(
		(task) =>
			getAgileArtifactType(task) === "okr" &&
			activeForMember(task, status, selectedAlias)
	);

	// For each assigned OKR, attempt to collect linked items (if blockId present).
	// If none found or no blockId, show the OKR alone and hide the Linked Items sub-section.
	type OKREntry = { okr: TaskItem; linkedTrees: TaskItem[] };
	const entries: OKREntry[] = assignedOKRs.map((okr) => {
		const code = okr.blockId;
		let linkedTrees: TaskItem[] = [];

		if (code && /^[A-Za-z0-9]{6}$/.test(code)) {
			// Look for visible, in-scope linked items with the 🔗🎯 link text pointing to ^blockId
			const linkedPattern = new RegExp(`${code}">🔗🎯`);
			const rawLinked = sectionTasks.filter((t) =>
				linkedPattern.test(t.text)
			);

			if (rawLinked.length > 0) {
				// Build pruned/merged trees
				linkedTrees = buildPrunedMergedTrees(rawLinked, taskMap);

				// Mark directly-linked items' leaves as "p" status to visually distinguish
				const linkedIds = new Set(
					rawLinked.map((t) => t._uniqueId ?? "")
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

				// Sort trees: any with active leaves come first, then with inactive leaves, then others
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

				linkedTrees.sort(
					(a, b) => getTreePriority(a) - getTreePriority(b)
				);
			}
		}

		return { okr, linkedTrees };
	});

	// Render only if we're in "Active" mode and there is at least one assigned OKR
	if (entries.length > 0 && status) {
		container.createEl("h2", { text: "🎯 Objectives" });

		entries.forEach(({ okr, linkedTrees }) => {
			// Render the OKR itself without its native children
			const okrShallow: TaskItem = { ...okr, children: [] };
			renderTaskTree(
				[okrShallow],
				container,
				app,
				0,
				false,
				"objectives",
				selectedAlias
			);

			// Enable folding on the OKR item
			try {
				attachSectionFolding(container, {
					app,
					taskMap,
					childrenMap,
					selectedAlias,
					renderTaskTree,
					registerDomEvent,
					sectionName: "objectives",
				});
			} catch {
				/* ignore */
			}

			// If there are linked items, render the Linked Items sub-section
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
					"objectives-linked",
					selectedAlias
				);

				try {
					attachSectionFolding(indentedWrapper, {
						app,
						taskMap,
						childrenMap,
						selectedAlias,
						renderTaskTree,
						registerDomEvent,
						sectionName: "objectives-linked",
					});
				} catch {
					/* ignore */
				}
			}
		});
	}
}
