import { App } from "obsidian";
import { TaskItem, TaskParams } from "@features/task-index";
import { renderTaskTree } from "./task-renderer";
import {
	activeForMember,
	isCancelled,
	isInProgress,
	isCompleted,
	isSnoozed,
	getAgileArtifactType,
} from "@features/task-filter";
import { buildPrunedMergedTrees } from "@features/task-tree-builder";
import type { AgileObsidianSettings } from "@settings/index";

export type ArtifactPredicate = (
	task: TaskItem,
	taskMap: Map<string, TaskItem>
) => boolean;

export interface ArtifactOptions {
	title: string;
	renderType: string; // passed to renderTaskTree
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

	const sectionTasks = currentTasks.filter((task) => {
		return (
			(inProgress && isInProgress(task, taskMap)) ||
			(completed && isCompleted(task)) ||
			(sleeping && isSnoozed(task, taskMap)) ||
			(cancelled && isCancelled(task))
		);
	});

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
			options.renderType,
			selectedAlias
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
				predicate: (t) => getAgileArtifactType(t) === "task",
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
				predicate: (t) => getAgileArtifactType(t) === "story",
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
				predicate: (t) => getAgileArtifactType(t) === "epic",
			}
		);
	}
}
