import { Pos } from "obsidian";

interface TaskLink {
    path: string; // Full file path
    display: string; // Display text for the link
    embed: boolean; // Whether it's an embedded link
    subpath: string; // Subpath within the file (e.g., heading or block ID)
}

export interface TaskItem {
	checked: boolean; // Whether the task is completed
	completed: boolean; // Completion status (often mirrors checked)
	fullyCompleted: boolean; // If fully done including subtasks
	text: string; // The raw text of the task/list item
	visual: string; // Visual representation (e.g., with checkboxes)
	line: number; // Line number in the file
	lineCount: number; // Number of lines the item spans
	position: Pos; // Position in the file
	children: TaskItem[]; // Subtasks or nested items
	task?: boolean; // True if it's a task (has checkbox), undefined otherwise
	listItem?: boolean; // True if it's a plain list item, undefined otherwise
	annotated: boolean; // If it has annotations (e.g., tags or dates)
	parent: number; // Line number of parent item
	blockId: string | undefined; // Block ID if present
	header: { link: TaskLink; level: number }; // Associated header info
	status?: string; // Status symbol (e.g., ' ' for unchecked, 'x' for checked) - only for tasks
	link: TaskLink; // Link to the task's location
	due?: string; // ISO date string (e.g., '2025-07-28')
	scheduled?: string; // ISO date string
	start?: string; // ISO date string
	// Add this for hierarchyUtils errors (a unique ID per task, e.g., generated in TaskIndex)
	_uniqueId?: string | null; // Optional unique identifier (e.g., filePath + line), allow null for unassigned/roots
	_parentId?: string | null; // Custom reference to parent's _uniqueId, allow null for roots
}

export interface TaskParams {
	inProgress: boolean;
	completed: boolean;
	sleeping: boolean;
	cancelled: boolean;
}