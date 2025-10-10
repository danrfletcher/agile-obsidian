import { TaskItem } from "@features/task-index";

/**
 * Minimal query surface from task-index.
 * Composition should adapt the concrete TaskIndexService to this port.
 */
export interface TaskIndexPort {
	getItemAtCursor(cursor: {
		filePath: string;
		lineNumber: number; // 0-based
	}): TaskItem | undefined;

	/**
	 * Resolve a TaskItem by a vault block reference string in the form:
	 *   "<filePath>#^<blockId>"
	 * Implementations may optionally support resolving "#^<blockId>" by scanning all files.
	 */
	getTaskByBlockRef(blockRef: string): TaskItem | undefined;
}
