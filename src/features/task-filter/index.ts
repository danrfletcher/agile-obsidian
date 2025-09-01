/**
 * Public API surface for task-filter feature.
 *
 * Exposes:
 * - getAgileArtifactType
 * - Task filters factory (if present)
 */
export { getAgileArtifactType } from "./domain/agile-artifact-types";
export * from "./domain/task-filters";
export type { AgileArtifactType } from "./domain/types";

