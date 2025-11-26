import { App } from "obsidian";
import { TaskItem, TaskParams } from "@features/task-index";
import { renderTaskTree } from "./task-renderer";
import { activeForMember, getAgileArtifactType } from "@features/task-filter";
import { buildPrunedMergedTrees } from "@features/task-tree-builder";
import type { AgileObsidianSettings } from "@settings/index";
import { isShownByParams } from "../utils/filters";
import { attachSectionFolding } from "@features/task-tree-fold";
import { normalizeSection } from "./ui-policy";

export type ArtifactPredicate = (
	task: TaskItem,
	taskMap: Map<string, TaskItem>
) => boolean;

export interface ArtifactOptions {
	title: string;
	renderType: string; // passed to renderTaskTree and used for folding sectionName
	predicate: ArtifactPredicate;
}

type RegisterDomEvent = (
	el: HTMLElement | Window | Document,
	type: string,
	handler: (evt: Event) => void,
	options?: AddEventListenerOptions | boolean
) => void;

/**
Create a per-section root wrapper to isolate DOM for Tasks/Stories/Epics,
render the section inside it, wire folding, and then "re-stamp" all task list
nodes in this section with the normalized section name to prevent any
post-processing code from accidentally overriding the data-section.
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
	registerDomEvent?: RegisterDomEvent
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
		// Normalize once and keep it consistent
		const normalizedType = normalizeSection(options.renderType);

		// Create an isolated root wrapper for this artifact section
		const sectionRoot = container.createEl("div", {
			cls: "agile-artifact-section",
			attr: {
				"data-section-root": normalizedType,
			},
		});

		// Heading
		sectionRoot.createEl("h2", { text: options.title });

		// Render into the section root
		renderTaskTree(
			prunedTasks,
			sectionRoot,
			app,
			0,
			false,
			normalizedType,
			selectedAlias
		);

		// Wire folding, scoped to this section only
		try {
			attachSectionFolding(sectionRoot, {
				app,
				taskMap,
				childrenMap,
				selectedAlias,
				renderTaskTree,
				registerDomEvent,
				sectionName: normalizedType,
				// No first-level gating for Tasks/Stories/Epics; bottom-only rule enforced by fold module.
			});
		} catch {
			/* ignore */
		}

		// Final pass: enforce correct data-section stamping across all lists/items
		// in this section only (protect against any accidental overrides elsewhere).
		try {
			const restamp = (root: HTMLElement, value: string) => {
				const uls = Array.from(
					root.querySelectorAll(
						"ul.agile-dashboard.contains-task-list"
					)
				) as HTMLElement[];
				uls.forEach((ul) => ul.setAttribute("data-section", value));

				const lis = Array.from(
					root.querySelectorAll("li.task-list-item")
				) as HTMLElement[];
				lis.forEach((li) => li.setAttribute("data-section", value));
			};
			restamp(sectionRoot, normalizedType);
		} catch {
			/* ignore */
		}
	}
}

/**
Render all artifacts sections that are enabled in settings.
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
	registerDomEvent?: RegisterDomEvent
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
			registerDomEvent
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
				renderType: "stories",
				predicate: (t) => getAgileArtifactType(t) === "story",
			},
			registerDomEvent
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
			registerDomEvent
		);
	}
}
