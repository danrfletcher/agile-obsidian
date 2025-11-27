/**
 * Template insertion workflows: reusable, ordered steps that may enrich params before insertion.
 *
 * Usage:
 * - A template declares insertWorkflows?: string[] on its TemplateDefinition.
 * - Each string can reference:
 *     a) a composed workflow (array of steps), OR
 *     b) a single step function by name.
 * - runTemplateWorkflows(def, params, ports) merges outputs from each step into params.
 *
 * Conventions:
 * - Steps are pure and rely on ports for side-effects/data fetch.
 * - Steps may stash temporary values on params using keys prefixed with "__wf_" (removed at the end).
 */

import type { TemplateDefinition } from "./types";
import type { TaskIndexPort } from "../app/templating-ports";
import type { TaskItem } from "@features/task-index";
import { getAgileArtifactType } from "@features/task-filter";

// Optional typing hint only; not required at runtime
export type AgileArtifactType =
	| "initiative"
	| "learning-initiative"
	| "epic"
	| "learning-epic"
	| "story"
	| "okr"
	| "recurring-responsibility"
	| "task";

export type WorkflowPorts = {
	taskIndex?: TaskIndexPort & {
		// Some implementations may support this optional method
		getTaskByBlockId?: (blockId: string) => TaskItem | undefined;
	};
};

export type WorkflowStep = (args: {
	params: Record<string, unknown>;
	ports: WorkflowPorts;
}) =>
	| Promise<Record<string, unknown> | void>
	| (Record<string, unknown> | void);

type BlockRefParams = { blockRef?: unknown };
type TaskItemScratchParams = { __wf_taskItem?: TaskItem | null };
type WorkflowParams = Record<string, unknown>;

// ------------------------
// Helpers (no Vault; normalization only)
// ------------------------

function parseBlockRef(raw: string): { filePart: string; blockId: string } {
	const s = String(raw || "").trim();
	const marker = "#^";
	const idx = s.indexOf(marker);
	if (idx === -1) return { filePart: s, blockId: "" };
	const filePart = s.slice(0, idx);
	const blockId = s.slice(idx + marker.length).trim();
	return { filePart, blockId };
}

function hasExtension(path: string): boolean {
	return /\.[a-zA-Z0-9]+$/.test(path);
}

function ensureMdSuffix(path: string): string {
	const p = String(path || "").trim();
	if (!p) return p;
	if (hasExtension(p)) return p;
	return `${p}.md`;
}

function normalizeBlockRefInput(source: unknown): string {
	if (source === undefined || source === null) return "";
	if (typeof source === "string") return source.trim();
	if (typeof source === "number" || typeof source === "boolean") {
		return String(source).trim();
	}
	try {
		const json = JSON.stringify(source);
		return typeof json === "string" ? json.trim() : "";
	} catch {
		return "";
	}
}

// ------------------------
// Reusable workflow steps
// ------------------------

/**
 * Step: resolveTaskItemFromBlockRef
 * Input: params.blockRef: string
 * Output: { __wf_taskItem?: TaskItem | null } // stashed for later steps
 *
 * Strategy: normalize the provided blockRef and try multiple TaskIndex keys:
 *  1) exact input
 *  2) "#^<blockId>" (global by id)
 *  3) "<file>.md#^<blockId>" (if file part lacks extension)
 *  4) getTaskByBlockId(blockId) if the port provides it
 */
export const resolveTaskItemFromBlockRef: WorkflowStep = async ({
	params,
	ports,
}) => {
	try {
		const source = (params as BlockRefParams).blockRef;
		const raw = normalizeBlockRefInput(source);

		const ti = ports.taskIndex;
		if (!raw || !ti?.getTaskByBlockRef) return {};

		const attempts: string[] = [];
		// 1) exact
		attempts.push(raw);

		// 2) "#^<blockId>" if we can parse it
		const { filePart, blockId } = parseBlockRef(raw);
		if (blockId) {
			attempts.push(`#^${blockId}`);
		}

		// 3) add .md if filePart present, lacks extension, and we have a blockId
		if (filePart && blockId && !hasExtension(filePart)) {
			attempts.push(`${ensureMdSuffix(filePart)}#^${blockId}`);
		}

		let task: TaskItem | null | undefined;

		for (const key of attempts) {
			try {
				task = ti.getTaskByBlockRef(key) ?? undefined;
				if (task) break;
			} catch {
				// ignore attempt errors
			}
		}

		// 4) Optional: if still not found and we have a blockId + helper
		if (!task && blockId && typeof ti.getTaskByBlockId === "function") {
			try {
				task = ti.getTaskByBlockId(blockId) ?? undefined;
			} catch {
				// ignore optional helper error
			}
		}

		return { __wf_taskItem: task ?? null };
	} catch {
		return {};
	}
};

/**
 * Step: resolveArtifactFromTask
 * Input: __wf_taskItem from previous step
 * Output: { linkedArtifactType?: AgileArtifactType }
 */
export const resolveArtifactFromTask: WorkflowStep = async ({ params }) => {
	try {
		const scratch = params as TaskItemScratchParams;
		const task = scratch.__wf_taskItem;
		if (!task) return {};
		const inferred = getAgileArtifactType(task);
		return inferred ? { linkedArtifactType: inferred } : {};
	} catch {
		return {};
	}
};

// ------------------------
// Composed workflows
// ------------------------

/**
 * A composed workflow is just an ordered array of steps.
 */
const WORKFLOWS: Record<string, WorkflowStep[]> = {
	resolveArtifactTypeFromBlockRef: [
		resolveTaskItemFromBlockRef,
		resolveArtifactFromTask,
	],
};

/**
 * Individual steps can also be referenced by name for flexibility.
 */
const STEPS: Record<string, WorkflowStep> = {
	resolveTaskItemFromBlockRef,
	resolveArtifactFromTask,
};

// ------------------------
// Runner
// ------------------------

/**
 * Execute declared insertWorkflows for a template (if any) and merge outputs into params.
 * Unknown workflow names are safely ignored.
 */
export async function runTemplateWorkflows(
	def: TemplateDefinition,
	initialParams: Record<string, unknown>,
	ports: WorkflowPorts
): Promise<Record<string, unknown>> {
	const names = def.insertWorkflows ?? [];
	let params: WorkflowParams = { ...initialParams };

	for (const name of names) {
		const steps = WORKFLOWS[name];
		if (Array.isArray(steps) && steps.length) {
			for (const step of steps) {
				const out = await step({ params, ports });
				if (out && typeof out === "object") {
					params = { ...params, ...out };
				}
			}
			continue;
		}
		const step = STEPS[name];
		if (typeof step === "function") {
			const out = await step({ params, ports });
			if (out && typeof out === "object") {
				params = { ...params, ...out };
			}
		}
	}

	// Strip internal workflow scratch fields
	for (const key of Object.keys(params)) {
		if (key.startsWith("__wf_")) {
			delete params[key];
		}
	}

	return params;
}