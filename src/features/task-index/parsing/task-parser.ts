import type { CachedMetadata, ListItemCache, TFile } from "obsidian";
import type {
	FileTaskSnapshot,
	TaskItem,
	TaskNode,
} from "../domain/task-types";
import {
	getCompletedDate,
	getCancelledDate,
	getStartDate,
	getScheduledDate,
	getDueDate,
	getTargetDate,
	getRecurringPattern,
	toYyyyMmDd,
} from "@features/task-date-manager";

/**
 * FileReadResult bundles the ingredients needed to parse a file.
 */
export interface FileReadResult {
	file: TFile;
	contents: string;
	cache: CachedMetadata;
}

/**
 * Parser interface for converting file inputs into a normalized TaskNode tree.
 */
export interface TaskParser {
	/**
	 * Parse a file into a normalized snapshot of task/list nodes.
	 * Pure given the read inputs.
	 */
	parseFile(read: FileReadResult): FileTaskSnapshot;
}

/**
 * Factory for a default parser implementation.
 */
export function createTaskParser(): TaskParser {
	return {
		parseFile: (read) => parseFileToSnapshot(read),
	};
}

/**
 * Full parse from Obsidian read inputs to TaskNode snapshot.
 * Steps:
 * 1) line extraction -> TaskItem
 * 2) hierarchy build
 * 3) derivations (fullyCompleted)
 * 4) id assignment
 */
function parseFileToSnapshot(read: FileReadResult): FileTaskSnapshot {
	const { file, contents, cache } = read;
	const lists = cache.listItems;
	if (!lists || lists.length === 0) {
		return { filePath: file.path, lists: [] };
	}

	const lines = contents.split(/\r?\n/);
	const itemMap: Record<number, TaskItem> = {};

	lists.forEach((li: ListItemCache) => {
		const lineNum0 = li.position.start.line;
		const lineNum1 = lineNum0 + 1;
		const lineText = lines[lineNum0] ?? "";

		const base = lineToItem(file, li, lineText, lineNum1);
		itemMap[lineNum0] = base;
	});

	const roots = buildHierarchy(itemMap);
	deriveFullyCompleted(roots);
	assignUniqueIds(roots, file.path);

	return {
		filePath: file.path,
		lists: roots as TaskNode[],
	};
}

/**
 * Convert a single list item line into a TaskItem with basic fields filled,
 * including date annotations parsed from the text.
 */
function lineToItem(
	file: TFile,
	li: ListItemCache,
	lineText: string,
	lineNum1: number
): TaskItem {
	const { text, blockId, rawStatus, isTask } = parseLineText(lineText);
	const checked = isTask ? rawStatus === "x" || rawStatus === "X" : false;

	const item: TaskItem = {
		checked,
		completed: checked,
		fullyCompleted: checked, // provisional; will be re-derived
		text,
		visual: lineText.trim(),
		line: lineNum1,
		lineCount: li.position.end.line - li.position.start.line + 1,
		position: li.position,
		children: [],
		task: isTask ? true : undefined,
		listItem: !isTask ? true : undefined,
		annotated: false,
		parent: li.parent ?? -1,
		blockId,
		header: {
			link: {
				path: file.path,
				display: "",
				embed: false,
				subpath: "",
			},
			level: 0,
		},
		status: isTask ? rawStatus : undefined,
		link: {
			path: file.path,
			display: file.basename,
			embed: false,
			subpath: blockId ? `#^${blockId}` : "",
		},
		_uniqueId: null,
		_parentId: null,
	};

	// Populate date properties from text markers
	const completedDt = getCompletedDate(item);
	const cancelledDt = getCancelledDate(item);
	const startDt = getStartDate(item);
	const scheduledDt = getScheduledDate(item);
	const dueDt = getDueDate(item);
	const targetDt = getTargetDate(item);
	const recurring = getRecurringPattern(item);

	if (completedDt) item.completedDate = toYyyyMmDd(completedDt);
	if (cancelledDt) item.cancelledDate = toYyyyMmDd(cancelledDt);
	if (startDt) item.start = toYyyyMmDd(startDt);
	if (scheduledDt) item.scheduled = toYyyyMmDd(scheduledDt);
	if (dueDt) item.due = toYyyyMmDd(dueDt);
	if (targetDt) item.target = toYyyyMmDd(targetDt);
	if (recurring) item.recurringPattern = recurring;

	// Mark as annotated if any date/pattern is present
	item.annotated = Boolean(
		item.completedDate ||
			item.cancelledDate ||
			item.start ||
			item.scheduled ||
			item.due ||
			item.target ||
			item.recurringPattern
	);

	return item;
}

/**
 * Build a root list from a map of 0-based parent relationships.
 */
function buildHierarchy(itemMap: Record<number, TaskItem>): TaskItem[] {
	const roots: TaskItem[] = [];
	Object.values(itemMap).forEach((item) => {
		if (item.parent >= 0 && itemMap[item.parent]) {
			itemMap[item.parent].children.push(item);
		} else {
			roots.push(item);
		}
	});
	return roots;
}

/**
 * Parse text, status, and trailing blockId from a list item line.
 */
function parseLineText(line: string): {
	text: string;
	blockId: string | undefined;
	rawStatus: string | undefined;
	isTask: boolean;
} {
	const match = line.match(
		/^[ \t]*(?:[-*+]|\d+[.)])\s*(?:\[(.)?\]\s*)?(.*)$/
	);
	const rawText = match ? match[2].trim() : line.trim();
	const rawStatus = match ? match[1] : undefined;
	const isTask = rawStatus !== undefined;

	const blockIdMatch = rawText.match(/\s*\^([A-Za-z0-9\-]+)$/);
	const text = blockIdMatch
		? rawText.slice(0, blockIdMatch.index).trim()
		: rawText;
	const blockId = blockIdMatch ? blockIdMatch[1] : undefined;

	return { text, blockId, rawStatus, isTask };
}

/**
 * Recompute fullyCompleted bottom-up after children attached.
 * Task nodes: fullyCompleted = checked && all children fullyCompleted.
 * List items: fullyCompleted = all children fullyCompleted.
 */
function deriveFullyCompleted(items: TaskItem[]) {
	const walk = (node: TaskItem): boolean => {
		const childrenComplete = node.children.map(walk).every(Boolean);
		node.fullyCompleted = node.task
			? node.checked && childrenComplete
			: childrenComplete;
		return node.fullyCompleted;
	};
	items.forEach(walk);
}

/**
 * Assign unique ids by file and line. Parent ids link accordingly.
 * If you later wish to harden IDs, incorporate blockId when present.
 */
function assignUniqueIds(items: TaskItem[], filePath: string) {
	const recurse = (item: TaskItem, parentId: string | null) => {
		item._uniqueId = item.blockId
			? `${filePath}:^${item.blockId}:${item.line}`
			: `${filePath}:${item.line}`;
		item._parentId = parentId;
		item.children.forEach((child) => recurse(child, item._uniqueId!));
	};
	items.forEach((it) => recurse(it, null));
}


