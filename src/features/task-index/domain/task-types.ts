import type { Pos } from "obsidian";

/**
 * Represents a link to a file/subpath in the vault.
 */
export interface TaskLink {
	/** Full file path (e.g., "Notes/Tasks.md") */
	path: string;
	/** Display text for the link (e.g., file basename) */
	display: string;
	/** Whether it's an embedded link */
	embed: boolean;
	/** Subpath within the file (e.g., "#^blockId" or "#Heading") */
	subpath: string;
}

/**
 * Input/normalized model of a task-like list item from Obsidian.
 * Note: In the parsing stage, we treat both task items (with checkbox) and plain list items uniformly.
 */
export interface TaskItem {
	/** Whether the task is checked (only meaningful if task === true) */
	checked: boolean;
	/** Completion status; mirrors checked for tasks, false for list items */
	completed: boolean;
	/** If fully done including subtasks (derived later) */
	fullyCompleted: boolean;
	/** The cleaned text content of the list item (no list marker or checkbox) */
	text: string;
	/** Visual representation of the original line (trimmed) */
	visual: string;
	/** 1-based line number in the file */
	line: number;
	/** Number of lines this list item spans in the source file */
	lineCount: number;
	/** Original position from Obsidian metadata cache */
	position: Pos;
	/** Subtasks or nested list items */
	children: TaskItem[];
	/** True if it's a task (has checkbox), undefined otherwise */
	task?: boolean;
	/** True if it's a plain list item, undefined otherwise */
	listItem?: boolean;
	/** If it has annotations (tags/dates) – parser may set later; default false */
	annotated: boolean;
	/** Line number of parent item (0-based from cache); -1 indicates no parent in cache */
	parent: number;
	/** Block ID if present (text suffix ^id) */
	blockId: string | undefined;
	/** Associated header info (minimal) */
	header: { link: TaskLink; level: number };
	/** Status symbol (Obsidian task char), only for tasks (e.g., ' ', 'x') */
	status?: string;
	/** Link to the task's location */
	link: TaskLink;

	/** Optional scheduling metadata (ISO "YYYY-MM-DD" strings) */
	due?: string;
	scheduled?: string;
	start?: string;

	/** Additional date properties parsed from text (ISO "YYYY-MM-DD" strings) */
	completedDate?: string; // from "✅ YYYY-MM-DD"
	cancelledDate?: string; // from "❌ YYYY-MM-DD"
	target?: string; // from "🎯 YYYY-MM-DD"

	/** Recurrence pattern text extracted from calendar markers ("🗓️ Mon-Fri", "Daily", etc.) */
	recurringPattern?: string;

	/**
	 * A unique ID constructed by the index (e.g., filePath:line).
	 * Allow null for unassigned or root allocation steps pre-assignment.
	 */
	_uniqueId?: string | null;
	/** Reference to parent's uniqueId; null for roots */
	_parentId?: string | null;
}

/**
 * A TaskNode is a TaskItem guaranteed to have _uniqueId/_parentId populated.
 */
export type TaskNode = TaskItem &
	Required<Pick<TaskItem, "_uniqueId" | "_parentId">>;

/**
 * Snapshot for a single file.
 */
export interface FileTaskSnapshot {
	/** File path this snapshot belongs to */
	filePath: string;
	/** Root-level items (each may have children) */
	lists: TaskNode[];
}

/**
 * Full in-memory index snapshot keyed by file path.
 */
export type TaskIndexSnapshot = Record<string, FileTaskSnapshot>;

/**
 * Public parameters for querying tasks, if needed later.
 */
export interface TaskParams {
	inProgress: boolean;
	completed: boolean;
	sleeping: boolean;
	cancelled: boolean;
}
