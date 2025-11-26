import type { TaskItem } from "@features/task-index";

/**
 * TaskItem plus extra runtime metadata used by the task-buttons feature.
 *
 * These fields are attached by other parts of the system but are not part of the
 * core TaskItem type.
 */
export type TaskWithMetadata = TaskItem & {
	/**
	 * Stable unique identifier for DOM attributes and events.
	 * Typically `${filePath}:${line}`.
	 */
	_uniqueId?: string;
	position?: {
		start?: {
			line?: number;
		};
	};
	/**
	 * Fallback line index used by some sources.
	 */
	line?: number;
	/**
	 * Alternative visual representation of the task text.
	 */
	visual?: string;
};

/**
 * Simple event bus for optimistic updates and notifications.
 */
export interface EventBusLike {
	dispatch(
		name: "agile:prepare-optimistic-file-change",
		payload: { filePath: string }
	): void;
	dispatch(
		name: "agile:task-snoozed",
		payload: { uid: string; filePath: string; date: string }
	): void;
	/**
	 * Fallback signature for other events emitted by the host application.
	 */
	dispatch(name: string, payload: Record<string, unknown>): void;
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