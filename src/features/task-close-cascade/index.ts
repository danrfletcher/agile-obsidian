// Public entry point for the task-closed-cascade feature.
// Expose only the safe API surface; block deep imports from app/ internals.

export {
	wireTaskClosedCascade,
	wireTaskClosedCascadeObserver,
} from "./app/closed-cascade";

// Thin public API facade (wiring-agnostic) for dashboards and other modules
export { createTaskClosedCascadeAPI } from "./api/task-closed-cascade-api";
export type {
	ClosedCascadeAPI as ClosedCascadeAPI,
	CascadeOptions as ClosedCascadeOptions,
	CascadeResult as ClosedCascadeResult,
	CascadeError as ClosedCascadeError,
	TaskId as ClosedTaskId,
	TaskNode as ClosedTaskNode,
	TaskIndexPort as ClosedTaskIndexPort,
	ClosedState,
} from "./api/task-closed-cascade-api";
