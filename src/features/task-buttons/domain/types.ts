import type { TaskItem } from "@features/task-index";

/**
 * Simple event bus for optimistic updates and notifications.
 */
export interface EventBusLike {
	dispatch<N extends string>(name: N, payload: any): void;
}

/**
 * Abstraction over file I/O.
 */
export interface FileRepository {
	readFile(path: string): Promise<string>;
	writeFile(path: string, content: string): Promise<void>;
}

/**
 * Time provider to enable deterministic testing.
 */
export interface TimeProvider {
	now(): Date;
	tomorrowISO(): string;
}

/**
 * Classifies a task into an artifact type (e.g., okr, recurring-responsibility, epic, etc.).
 */
export type ArtifactClassifier = (task: TaskItem) => string;

/**
 * Normalizes UI section type (maps raw section string → normalized key).
 */
export type SectionNormalizer = (sectionType: string) => string;

/**
 * Port for snoozing a single task.
 */
export type SnoozeSingleTask = (
	task: TaskItem,
	dateISO: string,
	userSlug: string
) => Promise<void>;

/**
 * Aggregated dependencies for the task-buttons module.
 */
export interface TaskButtonsDeps {
	fileRepo: FileRepository;
	time: TimeProvider;
	eventBus?: EventBusLike;
	artifactClassifier: ArtifactClassifier;
	normalizeSection: SectionNormalizer;
	snoozeSingleTask: SnoozeSingleTask;
}
