import { App, HTMLElement } from "obsidian";
import { TaskItem } from "../../types/TaskItem"; // Adjust path
import { renderTaskTree } from "../../components/TaskRenderer"; // Adjust path
import {
	activeForMember,
	isCancelled,
	isRelevantToday,
	isSleeping,
} from "../../utils/taskFilters"; // Adjust path (ensure isSleeping is exported)
import {
	deepClone,
	getTopAncestor,
	buildFullSubtree,
	getPathToAncestor,
	buildHierarchyFromPath,
} from "../../utils/hierarchyUtils"; // Adjust path (added missing imports from original)
import { isOKR } from "../../utils/taskTypes"; // Adjust path

export function processAndRenderObjectives(
	container: HTMLElement,
	currentTasks: TaskItem[],
	status: boolean,
	app: App,
	taskMap: Map<string, TaskItem>,
	childrenMap: Map<string, TaskItem[]>
) {
	// NEW: Strip fake headers (from original) to match hierarchy processing
	const stripFakeHeaders = (nodes: TaskItem[]): TaskItem[] => {
		const out: TaskItem[] = [];
		for (const node of nodes) {
			const isNowHeader =
				node.task === false && /🚀\s*\*\*Now\*\*/.test(node.text);
			if (isNowHeader) {
				// Allow "Now" headers only, promote children
				(node.children || []).forEach((child) => {
					child._parentId = node._parentId ?? null;
					child.parent = node.parent ?? null;
				});
				out.push(...stripFakeHeaders(node.children || []));
			} else {
				// Disallow other fake headers, but recurse
				out.push({
					...node,
					children: stripFakeHeaders(node.children || []),
				});
			}
		}
		return out;
	};

	// Apply stripping to currentTasks (run once before processing)
	currentTasks = stripFakeHeaders(currentTasks);

	// OKR Processing (aligned closely with original)
	const assignedOKRs = currentTasks.filter(
		(task) =>
			isOKR(task) &&
			activeForMember(task, status) &&
			!task.completed &&
			!isCancelled(task) &&
			task.status !== "-" &&
			isRelevantToday(task) &&
			!isSleeping(task) // Added from original filters
	);
	const assignedOKRSet = new Set(assignedOKRs.map((t) => t._uniqueId ?? "")); // Use '' as default

	const findLinkedOKRs = (okrSet: Set<string>) => {
		const linkedOKRs: { sourceOKR: TaskItem; linkedTrees: TaskItem[] }[] =
			[];
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

			// FIXED: Pattern to detect links in task.text like [🔗🎯](path/to/file.md#^XXXXXX)
			const linkedPattern = new RegExp(`${sixDigitCode}">🔗🎯`);

			// Grab raw linked tasks (check text for the link pattern)
			const rawLinked = currentTasks.filter((t) =>
				linkedPattern.test(t.text)
			);
			if (!rawLinked.length) return;

			// NEW: Group linked tasks by their unique top ancestor (root) to handle duplicates/overlaps
			const rootsMap = new Map<string, TaskItem[]>(); // Key: root _uniqueId, Value: array of linked tasks under that root
			rawLinked.forEach((linkedTask) => {
				const root = getTopAncestor(linkedTask); // Walk up to top ancestor (using existing function)
				if (!root) return;
				if (!rootsMap.has(root._uniqueId)) {
					rootsMap.set(root._uniqueId, []);
				}
				rootsMap.get(root._uniqueId)!.push(linkedTask);
			});

			// NEW: For each unique root, clone the full subtree, prune it, and mark linked tasks with 'p'
			const clonedLinkedTrees: TaskItem[] = [];
			rootsMap.forEach((linkedTasksInRoot, rootId) => {
				const originalRoot = taskMap.get(rootId);
				if (!originalRoot) return;
				const clonedRoot = deepClone(buildFullSubtree(originalRoot)); // Clone full subtree (using existing function)

				// Prune the cloned tree to only include paths to linked tasks (similar to processTaskHierarchy)
				function pruneToLinked(node: TaskItem): TaskItem | null {
					if (!node) return null;

					// Recursively prune children
					const prunedChildren = (node.children || [])
						.map((child) => pruneToLinked(child))
						.filter(Boolean) as TaskItem[];

					// Check if this node is a linked task (set 'p' here)
					const isLinked = linkedTasksInRoot.some(
						(lt) => lt._uniqueId === node._uniqueId
					);
					if (isLinked) {
						node.status = "p"; // Set 'p' on actual linked tasks (per your request)
						node.checked = true; // Force checked state for custom "p" rendering
						node.completed = false; // Keep as not fully completed
					}

					// Include this node if it's linked or has linked descendants
					if (isLinked || prunedChildren.length > 0) {
						// Update parent relationships in the cloned tree for coherence
						prunedChildren.forEach((child) => {
							child.parent = node.line ?? -1; // Align parent to cloned node
							child._parentId = node._uniqueId ?? "";
						});
						return { ...node, children: prunedChildren };
					}
					return null;
				}

				const prunedClonedRoot = pruneToLinked(clonedRoot);
				if (prunedClonedRoot) {
					clonedLinkedTrees.push(prunedClonedRoot);
				}
			});

			if (clonedLinkedTrees.length > 0) {
				linkedOKRs.push({
					sourceOKR: okrTask,
					linkedTrees: clonedLinkedTrees, // NEW: Return cloned/pruned trees instead of flat tasks
				});
			}
		});

		return linkedOKRs;
	};

	const linkedOKRs = findLinkedOKRs(assignedOKRSet);

	// Get unique okrRoots (top ancestors) – from original
	const okrRoots = Array.from(
		new Set(assignedOKRs.map(getTopAncestor).map((t) => t._uniqueId ?? ""))
	)
		.map((id) => taskMap.get(id))
		.filter((t): t is TaskItem => !!t); // Filter undefined

	// Build subtree (updated to match original preservation of ancestors)
	const buildOKRSubtree = (
		node: TaskItem,
		isOKRNode = false
	): TaskItem | null => {
		if (!node) return null;

		const isAssignedOKR = assignedOKRSet.has(node._uniqueId ?? "");
		if (isAssignedOKR) isOKRNode = true;

		// Get children from map (from original) – pass isOKRNode down if this is assigned
		const children = (childrenMap.get(node._uniqueId ?? "") || [])
			.map(
				(child) =>
					buildOKRSubtree(child, isAssignedOKR ? true : isOKRNode) // Propagate true to children if assigned
			)
			.filter(Boolean) as TaskItem[];

		if (isOKRNode) {
			let processedChildren = children;

			if (isAssignedOKR) {
				const linkedEntry = linkedOKRs.find(
					(entry) => entry.sourceOKR._uniqueId === node._uniqueId
				);
				if (linkedEntry && linkedEntry.linkedTrees.length > 0) {
					// Blank separator task (completed with all required properties from original)
					const blankTask: TaskItem = {
						text: "‎🔗 Linked", // Required: Text (invisible space + link emoji)
					};
					processedChildren.push(blankTask);

					// Append linked trees with deep parent setting (from original)
					linkedEntry.linkedTrees.forEach((tree) => {
						tree.parent = node.line ?? -1;
						tree._parentId = node._uniqueId ?? "";
						// Recurse to set parents on all descendants (ensures full tree linking)
						const setDeepParents = (
							subNode: TaskItem,
							parentId: string
						) => {
							subNode._parentId = parentId;
							(subNode.children || []).forEach((child) =>
								setDeepParents(child, subNode._uniqueId ?? "")
							);
						};
						setDeepParents(tree, node._uniqueId ?? "");
					});
					processedChildren = processedChildren.concat(
						linkedEntry.linkedTrees
					);
				}
			}
			return { ...node, children: processedChildren };
		} else {
			// Preserve node if it leads to OKR (less aggressive prune, from original)
			if (isAssignedOKR || children.length > 0) {
				return { ...node, children };
			}
			return null;
		}
	};

	const prunedOKRs = okrRoots
		.map((root) => buildOKRSubtree(root))
		.filter((root): root is TaskItem => root !== null);

	// Render if there are tasks (with header)
	if (prunedOKRs.length > 0) {
		container.createEl("h2", { text: "🎯 Objectives" });
		renderTaskTree(prunedOKRs, container, app, 0, false, "objectives");
	}
}
