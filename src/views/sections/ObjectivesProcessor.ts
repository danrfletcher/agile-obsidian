import { App } from "obsidian";
import { TaskItem } from "../../types/TaskItem"; // Adjust path
import { renderTaskTree } from "../../components/TaskRenderer"; // Adjust path
import {
	activeForMember,
	isCancelled,
	isRelevantToday,
} from "../../utils/taskFilters"; // Adjust path
import {
	deepClone,
	getTopAncestor,
	buildFullSubtree,
} from "../../utils/hierarchyUtils"; // Adjust path
import { isOKR } from "../../utils/taskTypes"; // Adjust path

export function processAndRenderObjectives(
	container: HTMLElement,
	currentTasks: TaskItem[],
	status: boolean,
	app: App,
	taskMap: Map<string, TaskItem>,
	childrenMap: Map<string, TaskItem[]>
) {
	// OKR Processing (extracted from original)
	const assignedOKRs = currentTasks.filter(
		(task) =>
			isOKR(task) &&
			activeForMember(task, status) &&
			!task.completed &&
			!isCancelled(task) &&
			task.status !== "-" &&
			isRelevantToday(task)
	);
	const assignedOKRSet = new Set(assignedOKRs.map((t) => t._uniqueId ?? "")); // Use '' as default

	const findLinkedOKRs = (okrSet: Set<string>) => {
		const linkedOKRs: {
			sourceOKR: TaskItem;
			linkedTrees: TaskItem[];
		}[] = [];
		Array.from(okrSet).forEach((okrId) => {
			const okrTask = taskMap.get(okrId);
			if (!okrTask) return;

			const codeMatch = okrTask.text.match(/\^([A-Za-z0-9]{6})$/);
			if (!codeMatch) return;
			const sixDigitCode = codeMatch[1];
			const linkedPattern = new RegExp(`${sixDigitCode}">🔗🎯`);

			const rawLinked = currentTasks.filter((t) =>
				linkedPattern.test(t.text)
			);
			if (!rawLinked.length) return;

			const rootsMap = new Map<string, TaskItem[]>();
			rawLinked.forEach((linkedTask) => {
				const root = getTopAncestor(linkedTask);
				if (!root || !root._uniqueId) return; // Guard
				if (!rootsMap.has(root._uniqueId)) {
					rootsMap.set(root._uniqueId, []);
				}
				rootsMap.get(root._uniqueId)?.push(linkedTask); // Safe
			});

			const clonedLinkedTrees: TaskItem[] = [];
			rootsMap.forEach((linkedTasksInRoot, rootId) => {
				const originalRoot = taskMap.get(rootId);
				if (!originalRoot) return;
				const clonedRoot = deepClone(buildFullSubtree(originalRoot));

				const pruneToLinked = (node: TaskItem): TaskItem | null => {
					if (!node) return null;
					const prunedChildren = (node.children || [])
						.map(pruneToLinked)
						.filter(Boolean) as TaskItem[];
					const isLinked = linkedTasksInRoot.some(
						(lt) => lt._uniqueId === node._uniqueId
					);
					if (isLinked) {
						node.status = "p";
						node.checked = true;
						node.completed = false;
					}
					if (isLinked || prunedChildren.length > 0) {
						prunedChildren.forEach((child) => {
							child.parent = node.line;
							child._parentId = node._uniqueId ?? ""; // Default
						});
						return { ...node, children: prunedChildren };
					}
					return null;
				};

				const prunedClonedRoot = pruneToLinked(clonedRoot);
				if (prunedClonedRoot) clonedLinkedTrees.push(prunedClonedRoot);
			});

			if (clonedLinkedTrees.length > 0) {
				linkedOKRs.push({
					sourceOKR: okrTask,
					linkedTrees: clonedLinkedTrees,
				});
			}
		});
		return linkedOKRs;
	};

	const linkedOKRs = findLinkedOKRs(assignedOKRSet);

	const okrRoots = Array.from(
		new Set(assignedOKRs.map(getTopAncestor).map((t) => t._uniqueId ?? ""))
	)
		.map((id) => taskMap.get(id))
		.filter((t): t is TaskItem => !!t); // Filter undefined

	const buildOKRSubtree = (
		node: TaskItem,
		isOKRNode = false
	): TaskItem | null => {
		const children = childrenMap.get(node._uniqueId ?? "") || []; // Default
		const isAssignedOKR = assignedOKRSet.has(node._uniqueId ?? "");
		if (isAssignedOKR) isOKRNode = true;

		if (isOKRNode) {
			let processedChildren = children
				.map((child) => buildOKRSubtree(child, true))
				.filter(Boolean) as TaskItem[];

			if (isAssignedOKR) {
				const linkedEntry = linkedOKRs.find(
					(entry) => entry.sourceOKR._uniqueId === node._uniqueId
				);
				if (linkedEntry && linkedEntry.linkedTrees.length > 0) {
					const blankTask: TaskItem = {
						checked: false, // Required: Whether the task is completed
						completed: false, // Required: Completion status (often mirrors checked)
						fullyCompleted: false, // Required: If fully done including subtasks
						text: "Linked Projects", // Required: The raw text of the task/list item (adjust if original was different)
						visual: "Linked Projects", // Required: Visual representation (mirroring text for dummy)
						line: -1, // Required: Line number in the file (use -1 for non-real tasks)
						lineCount: 1, // Required: Number of lines the item spans (minimal for dummy)
						position: {
							// Required: Position in the file (using Obsidian's Loc structure)
							start: { line: -1, col: 0, offset: 0 }, // Use 'col' and 'offset' instead of 'ch'
							end: { line: -1, col: 0, offset: 0 }, // Same for end
						},
						children: [], // Required: Subtasks or nested items (empty for separator)
						annotated: false, // Required: If it has annotations (e.g., tags or dates)
						parent: -1, // Required: Line number of parent item (use -1 for no parent)
						blockId: undefined, // Required: Block ID if present (undefined for none)
						header: {
							// Required: Associated header info
							link: {
								path: "",
								display: "",
								subpath: "",
								embed: false,
							}, // Include required 'display' and 'embed'
							level: 0, // No header level for dummy
						},
						link: {
							path: "",
							display: "",
							subpath: "",
							embed: false,
						}, // Required: Link to the task's location (include 'display' and 'embed')

						// Optional fields (set where useful for dummy)
						task: false, // Optional: True if it's a task (has checkbox) - false for separator
						status: " ", // Optional: Status symbol (space for todo)
						_uniqueId:
							"blank-" +
							Math.random().toString(36).substring(2, 9), // Optional: Generate a unique ID for hierarchy
						_parentId: null, // Optional: Custom reference to parent's _uniqueId (null for roots)
						// Omitted optionals: listItem, due, scheduled, start (undefined is fine)
					};
					processedChildren.push(blankTask);
					linkedEntry.linkedTrees.forEach((tree) => {
						tree.parent = node.line;
						tree._parentId = node._uniqueId ?? "";
					});
					processedChildren = processedChildren.concat(
						linkedEntry.linkedTrees
					);
				}
			}
			return { ...node, children: processedChildren };
		} else {
			const filteredChildren = children
				.map((child) => buildOKRSubtree(child, false))
				.filter(Boolean) as TaskItem[];
			if (isAssignedOKR || filteredChildren.length) {
				return { ...node, children: filteredChildren };
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
