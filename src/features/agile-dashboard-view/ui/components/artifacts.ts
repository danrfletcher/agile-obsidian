import { App } from "obsidian";
import { TaskItem, TaskParams } from "src/features/tasks/task-item";
import { renderTaskTree } from "./task-renderer";
import {
	activeForMember,
	isCancelled,
	isInProgress,
	isMarkedCompleted,
	isSleeping,
} from "src/features/agile-dashboard-view/domain/task-filters";
import { buildPrunedMergedTrees } from "src/features/agile-dashboard-view/domain/hierarchy-utils";
import type { AgileObsidianSettings } from "src/features/settings/settings.types";
import {
	isTask,
	isStory,
	isEpic,
} from "src/features/agile-dashboard-view/domain/task-types";

export type ArtifactPredicate = (
	task: TaskItem,
	taskMap: Map<string, TaskItem>
) => boolean;

export interface ArtifactOptions {
	title: string;
	renderType: string; // passed to renderTaskTree for styling/context
	predicate: ArtifactPredicate;
}

export function processAndRenderArtifact(
	container: HTMLElement,
	currentTasks: TaskItem[],
	status: boolean,
	selectedAlias: string | null,
	app: App,
	taskMap: Map<string, TaskItem>,
	childrenMap: Map<string, TaskItem[]>,
	taskParams: TaskParams,
	options: ArtifactOptions
) {
	const { inProgress, completed, sleeping, cancelled } = taskParams;

	// Apply params filter
	const sectionTasks = currentTasks.filter((task) => {
		return (
			(inProgress && isInProgress(task, taskMap)) ||
			(completed && isMarkedCompleted(task)) ||
			(sleeping && isSleeping(task, taskMap)) ||
			(cancelled && isCancelled(task))
		);
	});

	// Filter for tasks of this artifact type and active for member
	const directlyAssigned = sectionTasks.filter(
		(task) =>
			activeForMember(task, status, selectedAlias) &&
			options.predicate(task, taskMap)
	);

	const prunedTasks = buildPrunedMergedTrees(directlyAssigned, taskMap);

	if (prunedTasks.length > 0) {
		container.createEl("h2", { text: options.title });
		renderTaskTree(
			prunedTasks,
			container,
			app,
			0,
			false,
			options.renderType
		);
	}
}

export function processAndRenderArtifacts(
	container: HTMLElement,
	currentTasks: TaskItem[],
	status: boolean,
	selectedAlias: string | null,
	app: App,
	taskMap: Map<string, TaskItem>,
	childrenMap: Map<string, TaskItem[]>,
	taskParams: TaskParams,
	settings: AgileObsidianSettings
) {
	// Render Tasks/Stories/Epics in order if their corresponding settings are enabled
	if (settings.showTasks) {
		processAndRenderArtifact(
			container,
			currentTasks,
			status,
			selectedAlias,
			app,
			taskMap,
			childrenMap,
			taskParams,
			{
				title: "🔨 Tasks",
				renderType: "tasks",
				predicate: (t) => isTask(t),
			}
		);
	}
	if (settings.showStories) {
		processAndRenderArtifact(
			container,
			currentTasks,
			status,
			selectedAlias,
			app,
			taskMap,
			childrenMap,
			taskParams,
			{
				title: "📝 Stories",
				renderType: "tasks",
				predicate: (t) => isStory(t),
			}
		);
	}
	if (settings.showEpics) {
		processAndRenderArtifact(
			container,
			currentTasks,
			status,
			selectedAlias,
			app,
			taskMap,
			childrenMap,
			taskParams,
			{
				title: "🏆 Epics",
				renderType: "epics",
				predicate: (t) => isEpic(t),
			}
		);
	}
}
