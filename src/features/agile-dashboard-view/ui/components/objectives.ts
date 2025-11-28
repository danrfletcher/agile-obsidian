import { App, sanitizeHTMLToDom } from "obsidian";
import { TaskItem, TaskParams } from "@features/task-index";
import { renderTaskTree } from "./task-renderer";
import { activeForMember, getAgileArtifactType } from "@features/task-filter";
import { buildPrunedMergedTrees } from "@features/task-tree-builder";
import { isShownByParams } from "../utils/filters";
import { attachSectionFolding } from "@features/task-tree-fold";
import { inferTeamSlugFromPath } from "@features/org-structure";

type RegisterDomEvent = (
	el: HTMLElement | Window | Document,
	type: string,
	handler: (evt: Event) => void,
	options?: AddEventListenerOptions | boolean
) => void;

/**
Process and render Objectives (OKRs) and their linked item trees with a per-team limit.

Key behavior:
- Limit to at most one OKR per team among the OKRs assigned to the selected user.
- Selection policy: choose the first OKR encountered per team in the existing order
  (correlates to the first objective listed in the note that is not completed/cancelled).

Folding behavior (unchanged):
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
): void {
	const sectionTasks = currentTasks.filter((task) =>
		isShownByParams(task, taskMap, selectedAlias, taskParams)
	);

	// Assigned OKRs to the selected member (active assignment only)
	const assignedOKRs = sectionTasks.filter(
		(task) =>
			getAgileArtifactType(task) === "okr" &&
			activeForMember(task, status, selectedAlias)
	);

	// Build entries with inferred team slugs and linked item trees
	type OKREntry = {
		okr: TaskItem;
		linkedTrees: TaskItem[];
		teamSlug: string | null;
		origIndex: number;
	};

	const entries: OKREntry[] = assignedOKRs.map((okr, idx) => {
		const rawBlockId = okr.blockId ? String(okr.blockId) : "";
		const blockId = rawBlockId.startsWith("^")
			? rawBlockId.slice(1)
			: rawBlockId;

		// Resolve team slug for the OKR based on its file path by scanning path segments
		const filePath = okr.link?.path || (okr._uniqueId?.split(":")[0] ?? "");
		const teamSlug = inferTeamSlugFromPath(filePath);

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
			}
		}

		return {
			okr,
			linkedTrees,
			teamSlug,
			origIndex: idx,
		};
	});

	// First-encountered per team: keep the first OKR we see for each teamSlug (including one for "no team").
	const keyFor = (slug: string | null) => slug || "__no_team__";
	const seenTeams = new Set<string>();
	const entriesToRender: OKREntry[] = [];
	for (const e of entries) {
		const k = keyFor(e.teamSlug);
		if (!seenTeams.has(k)) {
			seenTeams.add(k);
			entriesToRender.push(e);
		}
	}

	// Render only if we're in "Active" mode and there is at least one selected OKR
	if (entriesToRender.length > 0 && status) {
		// eslint-disable-next-line obsidianmd/ui/sentence-case
		container.createEl("h2", { text: "🎯 Objectives" });

		entriesToRender.forEach(({ okr, linkedTrees }) => {
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
					text: "🔗 linked items",
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
 * This parses the raw string as HTML (sanitized) and returns values of the attributes indicated
 * by data-tpl-attr-var-<attribute>="blockRef" under a wrapper span with
 * data-linked-artifact-type="okr".
 */
function extractOkrBlockRefsFromText(raw: string): string[] {
	try {
		const fragment = sanitizeHTMLToDom(raw);

		const results = new Set<string>();
		const wrappers =
			fragment.querySelectorAll<HTMLElement>(
				'span[data-linked-artifact-type="okr"]'
			);

		wrappers.forEach((span) => {
			const els = span.querySelectorAll<HTMLElement>("*");
			els.forEach((el) => {
				for (const attr of Array.from(el.attributes)) {
					const m = attr.name.match(/^data-tpl-attr-var-(.+)$/);
					if (m && attr.value === "blockRef") {
						const targetAttrName = m[1];
						const blockRefVal =
							el.getAttribute(targetAttrName) || "";
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