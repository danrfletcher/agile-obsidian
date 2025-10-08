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

	// For each assigned OKR, collect linked items based on structured template attributes:
	// Discovery pool: search across ALL currentTasks (unfiltered) to avoid missing links due to visibility filters.
	// Visibility: after discovering links, filter by isShownByParams before rendering.
	type OKREntry = { okr: TaskItem; linkedTrees: TaskItem[] };
	const entries: OKREntry[] = assignedOKRs.map((okr) => {
		const rawBlockId = (okr as any)?.blockId
			? String((okr as any).blockId)
			: "";
		const blockId = rawBlockId.startsWith("^")
			? rawBlockId.slice(1)
			: rawBlockId;

		let linkedTrees: TaskItem[] = [];

		if (blockId) {
			// 1) Discover any items that link to this OKR block, regardless of status filters
			const discovered = currentTasks.filter((t) =>
				hasOkrBlockRefLink(t, blockId)
			);

			// 2) Respect visibility toggles for what we actually show
			const visibleLinked = discovered.filter((task) =>
				isShownByParams(task, taskMap, selectedAlias, taskParams)
			);

			if (visibleLinked.length > 0) {
				// Build pruned/merged trees from linked roots
				linkedTrees = buildPrunedMergedTrees(visibleLinked, taskMap);

				// Mark directly-linked items' leaves as "p" status to visually distinguish
				const linkedIds = new Set(
					visibleLinked.map((t) => t._uniqueId ?? "")
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

/**
 * Return true if the task text contains a templated OKR link whose blockRef attribute
 * references the given OKR blockId (i.e., the attribute value contains "#^<blockId>").
 *
 * Detection logic:
 * - Find span[data-linked-artifact-type="okr"]
 * - Within, find any element E where an attribute named data-tpl-attr-var-<attrName> has value "blockRef"
 * - Read E.getAttribute(<attrName>) to get the full blockRef (e.g., "OKRs (okrs-xyz)#^abcdef")
 * - Match when the value includes "#^<blockId>"
 */
function hasOkrBlockRefLink(task: TaskItem, blockId: string): boolean {
	const raw =
		(task.visual && task.visual.trim()) ||
		(task.text && task.text.trim()) ||
		"";
	if (!raw || !blockId) return false;
	const bid = blockId.startsWith("^") ? blockId.slice(1) : blockId;
	const refs = extractOkrBlockRefsFromText(raw);
	const needle = `#^${bid}`;
	return refs.some((r) => typeof r === "string" && r.includes(needle));
}

/**
 * Extract all OKR blockRef attribute values from the task's raw text/HTML.
 * This parses the raw string as HTML and returns values of the attributes indicated
 * by data-tpl-attr-var-<attribute>="blockRef" under a wrapper span with
 * data-linked-artifact-type="okr".
 */
function extractOkrBlockRefsFromText(raw: string): string[] {
	try {
		const container = document.createElement("div");
		container.innerHTML = raw;

		const results = new Set<string>();
		const wrappers = container.querySelectorAll(
			'span[data-linked-artifact-type="okr"]'
		) as NodeListOf<HTMLElement>;

		wrappers.forEach((span) => {
			const els = span.querySelectorAll("*") as NodeListOf<HTMLElement>;
			els.forEach((el) => {
				for (const attr of Array.from(el.attributes)) {
					const m = attr.name.match(/^data-tpl-attr-var-(.+)$/);
					if (m && attr.value === "blockRef") {
						const targetAttrName = m[1];
						const blockRefVal = el.getAttribute(targetAttrName) || "";
						if (blockRefVal) results.add(blockRefVal);
					}
				}
			});
		});

		return Array.from(results);
	} catch {
		return [];
	}
}