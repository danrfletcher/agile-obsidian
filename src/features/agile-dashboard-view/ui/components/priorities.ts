import { App } from "obsidian";
import { TaskItem, TaskParams } from "@features/task-index";
import { renderTaskTree } from "./task-renderer";
import {
	activeForMember,
	isCancelled,
	isSnoozed,
	getAgileArtifactType,
} from "@features/task-filter";
import type { AgileArtifactType } from "@features/task-filter";
import { isRelevantToday } from "@features/task-date-manager";
import { isShownByParams } from "../utils/filters";
import { attachSectionFolding } from "@features/task-tree-fold";

type RegisterDomEvent = (
	el: HTMLElement | Window | Document,
	type: string,
	handler: (evt: Event) => void,
	options?: AddEventListenerOptions | boolean
) => void;

/**
 * Process and render the Priorities section.
 *
 * Behavior:
 * - Start from "priority root" tasks (status "O", relevant today, non-snoozed, etc.).
 * - For each candidate root, walk its subtree to find descendant agile items whose
 *   type is in WHITELISTED_NESTED_TYPES and that:
 *     - are visible under the current TaskParams; and
 *     - are directly assigned/active for the selected member.
 *   Currently this whitelist includes:
 *     - "product"
 *     - "feature"
 *     - "kano-header"  (all Kano prioritization headers)
 *     - "moscow-header" (all MoSCoW prioritization headers)
 *
 * - Root visibility:
 *     - A root is shown if:
 *         - it is activeForMember for the selected user; OR
 *         - it has at least one such assigned whitelisted descendant.
 *
 * - Nested items behavior:
 *     - If the root IS assigned to the active user:
 *         - Do NOT pre-render any nested whitelisted children.
 *         - Only the root is shown initially, with a chevron; expansion is
 *           handled by task-tree-fold using the full childrenMap.
 *     - If the root is NOT assigned to the active user:
 *         - If it has whitelisted, assigned descendants, show those as shallow
 *           children under the root.
 *
 * - Recurring responsibilities are excluded entirely (neither roots nor descendants).
 */
export function processAndRenderPriorities(
	container: HTMLElement,
	currentTasks: TaskItem[],
	statusActive: boolean,
	selectedAlias: string | null,
	app: App,
	taskMap: Map<string, TaskItem>,
	childrenMap: Map<string, TaskItem[]>,
	taskParams: TaskParams,
	registerDomEvent?: RegisterDomEvent
): void {
	// No priorities in "Inactive" view
	if (!statusActive) {
		return;
	}

	// Cache artifact types per task id to avoid repeated parsing
	const artifactTypeCache = new Map<string, AgileArtifactType | null>();

	const getArtifactTypeCached = (
		task: TaskItem
	): AgileArtifactType | null => {
		const id = task._uniqueId;
		if (!id) {
			return getAgileArtifactType(task);
		}
		if (artifactTypeCache.has(id)) {
			return artifactTypeCache.get(id) ?? null;
		}
		const t = getAgileArtifactType(task);
		artifactTypeCache.set(id, t);
		return t;
	};

	const isRecurringResponsibility = (task: TaskItem): boolean =>
		getArtifactTypeCached(task) === "recurring-responsibility";

	// Whitelist of agile artifact types that can be auto-shown as nested
	// items under priority roots. Currently includes:
	// - "product"
	// - "feature"
	// - "kano-header"
	// - "moscow-header"
	const WHITELISTED_NESTED_TYPES: AgileArtifactType[] = [
		"product",
		"feature",
		"kano-header",
		"moscow-header",
	];

	const isWhitelistedNestedArtifact = (task: TaskItem): boolean => {
		const artifactType = getArtifactTypeCached(task);
		if (!artifactType) return false;
		return WHITELISTED_NESTED_TYPES.includes(artifactType);
	};

	// Helper: should a descendant appear in Priorities as a nested item?
	// This is future-proofed via WHITELISTED_NESTED_TYPES so more types can be
	// added without changing this logic.
	const isVisibleWhitelistedForPriorities = (
		task: TaskItem
	): boolean => {
		if (!task._uniqueId) return false;
		if (!isWhitelistedNestedArtifact(task)) return false;
		if (
			!isShownByParams(task, taskMap, selectedAlias, taskParams)
		) {
			return false;
		}
		// Only items that are assigned/active for the member
		if (!activeForMember(task, statusActive, selectedAlias)) {
			return false;
		}
		return true;
	};

	// 1) Identify "candidate priority root" tasks based on content/state
	const candidateRoots = currentTasks.filter((task: TaskItem) => {
		if (task.status !== "O") return false;
		if (task.completed) return false;
		if (!isRelevantToday(task)) return false;
		if (isCancelled(task)) return false;
		// Exclude items that are visually initiatives/epics/stories/notes headings
		if (task.text?.includes("🎖️")) return false;
		if (task.text?.includes("🏆")) return false;
		if (task.text?.includes("📝")) return false;
		if (isSnoozed(task, taskMap, selectedAlias)) return false;
		// Do not allow recurring responsibilities to be priority roots
		if (isRecurringResponsibility(task)) return false;
		return true;
	});

	if (candidateRoots.length === 0) {
		return;
	}

	// 2) For each candidate root, traverse descendants to collect assigned
	//    whitelisted items (product, feature, Kano/MoSCoW headers). We will
	//    later filter roots based on activeForMember and/or presence of such
	//    descendants.
	const rootsToShow: TaskItem[] = [];
	const nestedByRootId = new Map<string, TaskItem[]>();

	for (const root of candidateRoots) {
		const rootId = root._uniqueId;
		if (!rootId) continue;

		const queue: string[] = [rootId];
		const seen = new Set<string>();
		const nestedForRoot: TaskItem[] = [];

		while (queue.length > 0) {
			const currentId = queue.shift()!;
			if (!currentId || seen.has(currentId)) continue;
			seen.add(currentId);

			const children = childrenMap.get(currentId) || [];
			for (const child of children) {
				const childId = child._uniqueId;
				if (!childId) continue;

				// Collect eligible whitelisted descendants
				if (isVisibleWhitelistedForPriorities(child)) {
					nestedForRoot.push(child);
				}

				// Always traverse deeper to find whitelisted items further down the tree
				queue.push(childId);
			}
		}

		const rootIsActive = activeForMember(
			root,
			statusActive,
			selectedAlias
		);
		const hasAssignedWhitelisted = nestedForRoot.length > 0;

		// Root visibility rule:
		// - Show this root if it is active; OR
		// - Show this root if it has at least one assigned whitelisted descendant.
		if (!rootIsActive && !hasAssignedWhitelisted) {
			continue;
		}

		rootsToShow.push(root);

		// Nested visibility rule:
		// - Only attach whitelisted nested children for roots that are
		//   NOT assigned to the active user.
		// - For active roots, nested items will only be reachable via folding
		//   (chevron) using the full childrenMap.
		if (!rootIsActive && hasAssignedWhitelisted && rootId) {
			nestedByRootId.set(rootId, nestedForRoot);
		}
	}

	if (rootsToShow.length === 0) {
		// No roots that are active or that have assigned whitelisted descendants
		return;
	}

	// 3) Build the display trees:
	//    - each root in rootsToShow is shown;
	//    - for roots NOT assigned to the active user, their children are the
	//      collected whitelisted descendants (shallow),
	//      so they themselves have no children initially.
	//    - for roots assigned to the active user, we do not pre-attach any
	//      nested children; only the root is rendered initially.
	const orderedPriorityTrees: TaskItem[] = [];

	for (const root of rootsToShow) {
		const rootId = root._uniqueId;
		const rootNested = (rootId
			? nestedByRootId.get(rootId)
			: undefined) ?? [];

		const rootCopy: TaskItem = {
			...root,
			children: rootNested.map((child) => ({
				...child,
				// Do not pre-render any children; folding can reveal
				// their real children on demand.
				children: [],
			})),
		};

		orderedPriorityTrees.push(rootCopy);
	}

	// 4) Prepare task/children maps for folding that exclude recurring
	//    responsibilities entirely, so they can never appear in this section,
	//    even after expanding nodes.
	const prioritiesTaskMap = new Map<string, TaskItem>();
	const prioritiesChildrenMap = new Map<string, TaskItem[]>();

	for (const [id, task] of taskMap.entries()) {
		if (isRecurringResponsibility(task)) continue;
		prioritiesTaskMap.set(id, task);
	}

	for (const [id, children] of childrenMap.entries()) {
		const filteredChildren = children.filter(
			(child) => !isRecurringResponsibility(child)
		);
		prioritiesChildrenMap.set(id, filteredChildren);
	}

	// 5) Render section with its own root wrapper and enable folding.
	const sectionRoot = container.createEl("div", {
		cls: "agile-artifact-section",
		attr: {
			"data-section-root": "priorities",
		},
	});

	// eslint-disable-next-line obsidianmd/ui/sentence-case
	sectionRoot.createEl("h2", { text: "📂 Priorities" });

	// Render priority trees (roots + shallow children)
	renderTaskTree(
		orderedPriorityTrees,
		sectionRoot,
		app,
		0,
		false,
		"priorities",
		selectedAlias
	);

	// Enable folding scoped to this section, using the filtered maps
	// that exclude recurring responsibilities.
	try {
		attachSectionFolding(sectionRoot, {
			app,
			taskMap: prioritiesTaskMap,
			childrenMap: prioritiesChildrenMap,
			selectedAlias,
			renderTaskTree,
			registerDomEvent,
			sectionName: "priorities",
		});
	} catch {
		/* ignore */
	}

	// Final pass: enforce correct data-section stamping inside this section.
	try {
		const restamp = (rootEl: HTMLElement, value: string) => {
			const uls = Array.from(
				rootEl.querySelectorAll<HTMLElement>(
					"ul.agile-dashboard.contains-task-list"
				)
			);
			uls.forEach((ul) => ul.setAttribute("data-section", value));

			const lis = Array.from(
				rootEl.querySelectorAll<HTMLElement>("li.task-list-item")
			);
			lis.forEach((li) => li.setAttribute("data-section", value));
		};
		restamp(sectionRoot, "priorities");
	} catch {
		/* ignore */
	}
}