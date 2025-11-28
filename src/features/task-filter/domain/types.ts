/**
 * Domain types and constants for task filtering and agile artifact classification.
 *
 * Centralizes:
 * - Branded union types for artifact categories
 * - Task status semantics (if not already exported by @features/task-index)
 * - Emoji tokens and tag/class tokens used by filters
 * - Common regex fragments
 */

export type AgileArtifactType =
	| "initiative"
	| "learning-initiative"
	| "epic"
	| "learning-epic"
	| "story"
	| "okr"
	| "recurring-responsibility"
	| "product"
	| "feature"
	| "kano-header"
	| "moscow-header"
	| "task";

/**
 * Known TaskItem status codes.
 * If @features/task-index exports a canonical enum, prefer importing that.
 */
export enum TaskStatusCode {
	Open = "O",
	Done = "d",
	Category = "A",
	// Add other known codes here as needed, ensuring clear semantics.
}

/**
 * Tokens and markers used within task text.
 */
export const Tokens = {
	CompletedEmoji: "✅",
	CancelledEmoji: "❌",
	SnoozeEmoji: "💤",
	SnoozeInheritedMarker: "⬇️",
	ActivePrefix: "active-",
	InactivePrefix: "inactive-",
	ActiveTeamClass: "active-team",
	// Calendar variations are handled via regex in filters for robustness.
} as const;