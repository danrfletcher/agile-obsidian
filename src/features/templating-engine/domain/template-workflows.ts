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
 * - Steps rely on ports for side-effects/data fetch (e.g. the link-artifact step reads the
 *   linked note on demand through `ports.app`; there is no vault-wide index).
 * - Steps may stash temporary values on params using keys prefixed with "__wf_" (removed at the end).
 */

import type { TemplateDefinition } from "./types";
import type { ArtifactTaskLike } from "./templates-in-tasks";
import {
	artifactTypeOfTarget,
	resolveBlockRefTarget,
	type LinkArtifactApp,
} from "./link-artifact-resolver";

export type { AgileArtifactType } from "./artifact-type";

/**
 * What steps may use to reach the vault. `sourcePath` is the note the chip lives in
 * (used to resolve link-text style blockRefs the way a wiki link would).
 */
export type WorkflowPorts = {
	app?: LinkArtifactApp;
	sourcePath?: string;
};

export type WorkflowStep = (args: {
	params: Record<string, unknown>;
	ports: WorkflowPorts;
}) =>
	| Promise<Record<string, unknown> | void>
	| (Record<string, unknown> | void);

type BlockRefParams = { blockRef?: unknown };
type TaskLikeScratchParams = { __wf_taskItem?: ArtifactTaskLike | null };
type WorkflowParams = Record<string, unknown>;

// ------------------------
// Reusable workflow steps
// ------------------------

/**
 * Step: resolveTaskItemFromBlockRef
 * Input: params.blockRef: string
 * Output: { __wf_taskItem?: { text, status? } | null } // stashed for later steps
 *
 * Reads the file named by the blockRef on demand and returns the line carrying the
 * block id. Null when the target can't be found or read.
 */
export const resolveTaskItemFromBlockRef: WorkflowStep = async ({
	params,
	ports,
}) => {
	if (!ports.app) return {};
	const item = await resolveBlockRefTarget(
		ports.app,
		(params as BlockRefParams).blockRef,
		ports.sourcePath ?? ""
	);
	return { __wf_taskItem: item };
};

/**
 * Step: resolveArtifactFromTask
 * Input: __wf_taskItem from previous step
 * Output: { linkedArtifactType?: AgileArtifactType }
 *
 * Always sets linkedArtifactType (undefined when the target has no artefact type), so
 * a type carried in from an earlier render never survives a re-resolution.
 */
export const resolveArtifactFromTask: WorkflowStep = ({ params }) => {
	const task = (params as TaskLikeScratchParams).__wf_taskItem;
	const inferred = task ? artifactTypeOfTarget(task) : undefined;
	return { linkedArtifactType: inferred };
};

// ------------------------
// Composed workflows
// ------------------------

/**
 * A composed workflow is just an ordered array of steps.
 * Maps (not object literals) so names like "constructor" are never mistaken for steps.
 */
const WORKFLOWS = new Map<string, WorkflowStep[]>([
	[
		"resolveArtifactTypeFromBlockRef",
		[resolveTaskItemFromBlockRef, resolveArtifactFromTask],
	],
]);

/**
 * Individual steps can also be referenced by name for flexibility.
 */
const STEPS = new Map<string, WorkflowStep>([
	["resolveTaskItemFromBlockRef", resolveTaskItemFromBlockRef],
	["resolveArtifactFromTask", resolveArtifactFromTask],
]);

// ------------------------
// Runner
// ------------------------

/**
 * Execute declared insertWorkflows for a template (if any) and merge outputs into params.
 * Steps are awaited in order, so callers can render with the resolved params.
 * Unknown workflow names are safely ignored, and a step that rejects is skipped:
 * workflows enrich params on a best-effort basis and never block insertion/edit.
 */
export async function runTemplateWorkflows(
	def: TemplateDefinition,
	initialParams: Record<string, unknown>,
	ports: WorkflowPorts
): Promise<Record<string, unknown>> {
	const names = def.insertWorkflows ?? [];
	let params: WorkflowParams = { ...initialParams };

	for (const name of names) {
		const steps = WORKFLOWS.get(name) ?? [STEPS.get(name)];
		for (const step of steps) {
			if (typeof step !== "function") continue;
			try {
				const out = await step({ params, ports });
				if (out && typeof out === "object") {
					params = { ...params, ...out };
				}
			} catch {
				// Best-effort enrichment: skip a failing step.
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
