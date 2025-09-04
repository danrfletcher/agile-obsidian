import { TaskItem } from "@features/tasks";

/**
 * Minimal query surface from task-index.
 * Composition should adapt the concrete TaskIndexService to this port.
 */
export interface TaskIndexPort {
	getItemAtCursor(cursor: {
		filePath: string;
		lineNumber: number; // 0-based
	}): TaskItem | undefined;
}
