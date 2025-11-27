// Public entry point for the task-assignment-cascade feature.
// Currently we only expose the event wiring used by the Obsidian plugin.
// If/when a typed dashboard API is added, it should live under ./api
// and be re-exported from this module.

export { wireTaskAssignmentCascade } from "./app/assignment-cascade";