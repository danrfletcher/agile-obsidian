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

export function publishTaskStatusChanged(detail: TaskStatusChangedDetail) {
	try {
		document.dispatchEvent(
			new CustomEvent("agile:task-status-changed" as any, { detail })
		);
	} catch {
		/* ignore */
	}
}
