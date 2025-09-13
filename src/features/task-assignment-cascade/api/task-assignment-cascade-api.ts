// Minimal, stable types for dashboard use. Keep these local to avoid deep-coupling.
export type AssigneeId = string; // e.g., "user:123", "team:design", "everyone"
export type TaskId = string;

// Optional index port shape that mirrors the minimal capabilities we might use.
// If your task-index feature exposes public types already, you can alias them here instead.
export interface TaskIndexPort {
	isReady(): boolean;
	whenReady(timeoutMs?: number): Promise<boolean>;
	getTask(taskId: TaskId): TaskNode | null;
	getChildren(taskId: TaskId): TaskNode[];
	getParent(taskId: TaskId): TaskNode | null;
	getSubtree?(taskId: TaskId): TaskNode[];
}

export interface TaskNode {
	id: TaskId;
	assigneeId?: AssigneeId | null;
}

export interface CascadeOptions {
	// If you have a TaskIndex instance/port, pass it; otherwise best-effort fallback will be used.
	taskIndex?: TaskIndexPort | null;

	// If operating in a document/editor context, root can be supplied by the app layer.
	// In headless dashboard contexts, omit it.
	root?: Document | ShadowRoot | HTMLElement;

	// If true, runs a fast path (no waiting for index readiness).
	bestEffort?: boolean;

	// Max time to wait for TaskIndex readiness (ms). Defaults to 1500.
	indexReadyTimeoutMs?: number;

	// Suppress DOM CustomEvents by default in dashboard contexts.
	suppressDomEvents?: boolean;
}

export interface CascadeResult {
	changedTaskIds: TaskId[];
	errors?: CascadeError[];
	durationMs: number;
	usedIndex: boolean;
}

export interface CascadeError {
	code:
		| "INDEX_TIMEOUT"
		| "TASK_NOT_FOUND"
		| "INVALID_ASSIGNEE"
		| "INVARIANT_BROKEN"
		| "UNKNOWN";
	message: string;
	taskId?: TaskId;
}

export interface CascadeAPI {
	// Re-run cascade over a root (task or entire doc) to enforce explicit/implicit consistency.
	runCascade(
		options?: CascadeOptions & { rootTaskId?: TaskId }
	): Promise<CascadeResult>;

	// Set an assignee for a specific task, then run localized/necessary cascade.
	setAssigneeAndCascade(
		taskId: TaskId,
		assigneeId: AssigneeId | null,
		options?: CascadeOptions
	): Promise<CascadeResult>;

	// Normalize entire project/document (expensive) — good for migrations/repairs.
	normalizeAll(options?: CascadeOptions): Promise<CascadeResult>;
}

// The concrete engine and command dep shapes are intentionally minimal and internal.
// Your app/feature wiring will supply these at composition time without exposing internals publicly.
type InternalCascadeEngine = {
	run(options: {
		taskIndex?: TaskIndexPort | null;
		root?: Document | ShadowRoot | HTMLElement;
		rootTaskId?: TaskId;
		bestEffort?: boolean;
		indexReadyTimeoutMs?: number;
		suppressDomEvents?: boolean;
	}): Promise<CascadeResult>;

	onAssigneeChanged(
		taskId: TaskId,
		assigneeId: AssigneeId | null,
		options: {
			taskIndex?: TaskIndexPort | null;
			root?: Document | ShadowRoot | HTMLElement;
			bestEffort?: boolean;
			indexReadyTimeoutMs?: number;
			suppressDomEvents?: boolean;
		}
	): Promise<CascadeResult>;
};

type InternalAssignmentCommands = {
	setAssignee(
		taskId: TaskId,
		assigneeId: AssigneeId | null,
		ctx?: { root?: Document | ShadowRoot | HTMLElement }
	): Promise<void>;
};

export function createTaskAssignmentCascadeAPI(deps: {
	cascadeEngine: InternalCascadeEngine;
	assignmentCommands?: InternalAssignmentCommands;
}): CascadeAPI {
	const DEFAULT_INDEX_TIMEOUT = 1500;

	async function runCascade(
		options?: CascadeOptions & { rootTaskId?: TaskId }
	): Promise<CascadeResult> {
		const {
			taskIndex = null,
			root,
			bestEffort = false,
			indexReadyTimeoutMs = DEFAULT_INDEX_TIMEOUT,
			suppressDomEvents = false,
			rootTaskId,
		} = options || {};

		return deps.cascadeEngine.run({
			taskIndex,
			root,
			rootTaskId,
			bestEffort,
			indexReadyTimeoutMs,
			suppressDomEvents,
		});
	}

	async function setAssigneeAndCascade(
		taskId: TaskId,
		assigneeId: AssigneeId | null,
		options?: CascadeOptions
	): Promise<CascadeResult> {
		const {
			taskIndex = null,
			root,
			bestEffort = false,
			indexReadyTimeoutMs = DEFAULT_INDEX_TIMEOUT,
			suppressDomEvents = true, // default true for dashboard/headless triggers
		} = options || {};

		if (deps.assignmentCommands) {
			await deps.assignmentCommands.setAssignee(taskId, assigneeId, {
				root,
			});
		}
		return deps.cascadeEngine.onAssigneeChanged(taskId, assigneeId, {
			taskIndex,
			root,
			bestEffort,
			indexReadyTimeoutMs,
			suppressDomEvents,
		});
	}

	async function normalizeAll(
		options?: CascadeOptions
	): Promise<CascadeResult> {
		const {
			taskIndex = null,
			root,
			bestEffort = false,
			indexReadyTimeoutMs = DEFAULT_INDEX_TIMEOUT,
			suppressDomEvents = true,
		} = options || {};

		return deps.cascadeEngine.run({
			taskIndex,
			root,
			rootTaskId: undefined,
			bestEffort,
			indexReadyTimeoutMs,
			suppressDomEvents,
		});
	}

	return {
		runCascade,
		setAssigneeAndCascade,
		normalizeAll,
	};
}
