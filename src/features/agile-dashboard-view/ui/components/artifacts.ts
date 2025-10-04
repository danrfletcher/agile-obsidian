import { App, Component } from "obsidian";
import { TaskItem, TaskParams } from "@features/task-index";
import { renderTaskTree } from "./task-renderer";
import { activeForMember, getAgileArtifactType } from "@features/task-filter";
import { buildPrunedMergedTrees } from "@features/task-tree-builder";
import type { AgileObsidianSettings } from "@settings/index";
import { isShownByParams } from "../utils/filters";

export type ArtifactPredicate = (
	task: TaskItem,
	taskMap: Map<string, TaskItem>
) => boolean;

export interface ArtifactOptions {
	title: string;
	renderType: string; // passed to renderTaskTree
	predicate: ArtifactPredicate;
}

/**
 * Process and render a single artifact section (Tasks/Stories/Epics) into the container.
 */
export function processAndRenderArtifact(
	container: HTMLElement,
	currentTasks: TaskItem[],
	status: boolean,
	selectedAlias: string | null,
	app: App,
	taskMap: Map<string, TaskItem>,
	childrenMap: Map<string, TaskItem[]>,
	taskParams: TaskParams,
	options: ArtifactOptions,
	owner: Component
) {
	const sectionTasks = currentTasks.filter((task) =>
		isShownByParams(task, taskMap, selectedAlias, taskParams)
	);

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
			owner,
			app,
			0,
			false,
			options.renderType,
			selectedAlias
		);
	}
}

/**
 * Render all artifacts sections that are enabled in settings.
 */
export function processAndRenderArtifacts(
	container: HTMLElement,
	currentTasks: TaskItem[],
	status: boolean,
	selectedAlias: string | null,
	app: App,
	taskMap: Map<string, TaskItem>,
	childrenMap: Map<string, TaskItem[]>,
	taskParams: TaskParams,
	settings: AgileObsidianSettings,
	owner: Component
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
			},
			owner
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
			},
			owner
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
			},
			owner
		);
	}
}
