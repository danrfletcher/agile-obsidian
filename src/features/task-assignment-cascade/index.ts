// Public entry point for the task-assignment-cascade feature.
// Expose only the safe API surface; block deep imports from app/ internals.

export { wireTaskAssignmentCascade } from "./app/assignment-cascade";

// Thin public API facade for dashboards and other modules
export { createTaskAssignmentCascadeAPI } from "./api/task-assignment-cascade-api";
export type {
	CascadeAPI,
	CascadeOptions,
	CascadeResult,
	CascadeError,
	AssigneeId,
	TaskId,
	TaskNode,
	TaskIndexPort,
} from "./api/task-assignment-cascade-api";
