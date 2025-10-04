import type { App } from "obsidian";
import { createPathFileRepository } from "@platform/obsidian";
import {
	createTaskButtonsAPI,
	type EventBusLike,
	type TimeProvider,
	type SnoozeSingleTask,
	type ArtifactClassifier,
} from "@features/task-buttons";
import { getAgileArtifactType } from "@features/task-filter";
import { normalizeSection as normalizeSectionPolicy } from "@features/agile-dashboard-view";
import { snoozeTask } from "@features/task-snooze";
import type { TaskItem } from "@features/task-index";

/**
 * Default local-time TimeProvider.
 */
const defaultTimeProvider: TimeProvider = {
	now: () => new Date(),
	tomorrowISO: () => {
		const d = new Date();
		d.setDate(d.getDate() + 1);
		const yyyy = d.getFullYear();
		const mm = String(d.getMonth() + 1).padStart(2, "0");
		const dd = String(d.getDate()).padStart(2, "0");
		return `${yyyy}-${mm}-${dd}`;
	},
};

/**
 * Application-level orchestration for task-buttons on Obsidian.
 * Creates a task-buttons API instance wired to platform/obsidian and feature ports.
 */
export function createObsidianTaskButtonsAPI(
	app: App,
	eventBus?: EventBusLike
) {
	const fileRepo = createPathFileRepository(app);

	// Bind Obsidian-dependent snoozeSingleTask to the feature port.
	const snoozeSingleTask: SnoozeSingleTask = async (
		task: TaskItem,
		dateISO: string,
		userSlug: string
	) => {
		await snoozeTask(task, app, userSlug, dateISO);
	};

	// Wrap artifact type to guarantee a string (avoid null)
	const artifactClassifier: ArtifactClassifier = (task) =>
		getAgileArtifactType(task) ?? "";

	return createTaskButtonsAPI({
		fileRepo,
		time: defaultTimeProvider,
		eventBus,
		artifactClassifier,
		normalizeSection: normalizeSectionPolicy,
		snoozeSingleTask,
	});
}
