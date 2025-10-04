/**
 * Task Buttons module
 * Used by agile-dashboard-view to display snooze & snooze all subtasks buttons on relevant tasks.
 * Potentially used in future features e.g., to display buttons on tasks in regular notes or other custom views.
 * 
 * Barrel for task-buttons public API.
 *
 * This module is wiring-agnostic. Provide its dependencies via the factory
 * from app/appendButtons.ts in your composition module.
 */

export type {
	EventBusLike,
	FileRepository,
	TimeProvider,
	ArtifactClassifier,
	SectionNormalizer,
	SnoozeSingleTask,
	TaskButtonsDeps,
} from "./domain/types";

export { createTaskButtonsAPI } from "./app/append-buttons";

export { createObsidianTaskButtonsAPI } from "./app/create-task-buttons-api";
export { hideTaskAndCollapseAncestors } from "./ui/utils/dom";
