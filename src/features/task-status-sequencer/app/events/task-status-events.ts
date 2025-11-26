/**
 * App: Event publisher for task status changes.
 */
export type TaskStatusChangedDetail = {
	filePath: string;
	id: string;
	line0: number;
	fromStatus: string | null | undefined;
	toStatus: string | null | undefined;
};

export function publishTaskStatusChanged(
	detail: TaskStatusChangedDetail
): void {
	try {
		const event = new CustomEvent<TaskStatusChangedDetail>(
			"agile:task-status-changed",
			{ detail }
		);
		document.dispatchEvent(event);
	} catch {
		/* ignore */
	}
}