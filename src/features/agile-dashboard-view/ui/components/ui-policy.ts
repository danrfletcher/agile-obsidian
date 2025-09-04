export type TaskSection =
	| "objectives"
	| "responsibilities"
	| "priorities"
	| "initiatives"
	| "epics"
	| "stories"
	| "tasks";

export interface TaskUIPolicy {
	section: TaskSection;
}
