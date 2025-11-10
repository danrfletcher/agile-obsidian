// Minimal, stable types for dashboard/headless use. Keep local to avoid deep coupling.
export type TaskId = string;

export interface TaskIndexPort {
	isReady?(): boolean;
	whenReady?(timeoutMs?: number): Promise<boolean>;
	getTask?(taskId: TaskId): TaskNode | null;
	getChildren?(taskId: TaskId): TaskNode[];
	getParent?(taskId: TaskId): TaskNode | null;
	getSubtree?(taskId: TaskId): TaskNode[];
}

export interface TaskNode {
	id: TaskId;
	status?: string;
}

export type ClosedState = "completed" | "cancelled";

export interface CascadeOptions {
	taskIndex?: TaskIndexPort | null;
	root?: Document | ShadowRoot | HTMLElement;
	bestEffort?: boolean;
	indexReadyTimeoutMs?: number;
	suppressDomEvents?: boolean;
}

export interface CascadeResult {
	changedTaskIds: TaskId[];
	errors?: CascadeError[];
	durationMs: number;
	usedIndex: boolean;
}

export interface CascadeError {
	code: "INDEX_TIMEOUT" | "TASK_NOT_FOUND" | "INVARIANT_BROKEN" | "UNKNOWN";
	message: string;
	taskId?: TaskId;
}

/**
 * Public facade for closed cascade orchestration (engine provided by DI).
 * This API is transport-agnostic and wiring-agnostic.
 */
export interface ClosedCascadeAPI {
	runCascade(
		options?: CascadeOptions & { rootTaskId?: TaskId }
	): Promise<CascadeResult>;
	markClosedAndCascade(
		taskId: TaskId,
		state: ClosedState,
		date?: string | null,
		options?: CascadeOptions
	): Promise<CascadeResult>;
	normalizeAll(options?: CascadeOptions): Promise<CascadeResult>;
}

// NOTE: This file defines only the public facade types; actual engine wiring
// is app-specific and provided by the caller via dependency injection.
type InternalClosedCascadeEngine = {
	run(options: {
		taskIndex?: TaskIndexPort | null;
		root?: Document | ShadowRoot | HTMLElement;
		rootTaskId?: TaskId;
		bestEffort?: boolean;
		indexReadyTimeoutMs?: number;
		suppressDomEvents?: boolean;
	}): Promise<CascadeResult>;
	onTaskClosed(
		taskId: TaskId,
		state: ClosedState,
		date: string | null | undefined,
		options: {
			taskIndex?: TaskIndexPort | null;
			root?: Document | ShadowRoot | HTMLElement;
			bestEffort?: boolean;
			indexReadyTimeoutMs?: number;
			suppressDomEvents?: boolean;
		}
	): Promise<CascadeResult>;
};

type InternalClosedCommands = {
	setClosedState(
		taskId: TaskId,
		state: ClosedState,
		date: string | null | undefined,
		ctx?: { root?: Document | ShadowRoot | HTMLElement }
	): Promise<void>;
};

export function createTaskClosedCascadeAPI(deps: {
	cascadeEngine: InternalClosedCascadeEngine;
	closedCommands?: InternalClosedCommands;
}): ClosedCascadeAPI {
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

	async function markClosedAndCascade(
		taskId: TaskId,
		state: ClosedState,
		date?: string | null,
		options?: CascadeOptions
	): Promise<CascadeResult> {
		const {
			taskIndex = null,
			root,
			bestEffort = false,
			indexReadyTimeoutMs = DEFAULT_INDEX_TIMEOUT,
			suppressDomEvents = true,
		} = options || {};
		if (deps.closedCommands) {
			await deps.closedCommands.setClosedState(taskId, state, date, {
				root,
			});
		}
		return deps.cascadeEngine.onTaskClosed(taskId, state, date ?? null, {
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

	return { runCascade, markClosedAndCascade, normalizeAll };
}
