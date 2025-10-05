/**
 * Adapter: delegates task button logic to the task-buttons feature,
 * injecting the Agile Dashboard event bus for optimistic updates.
 *
 * Updated to use the new task-buttons orchestration factory and API.
 */

import type { App } from "obsidian";
import type { TaskItem } from "@features/task-index";
import { eventBus } from "../../app/event-bus";
import { createObsidianTaskButtonsAPI } from "@features/task-buttons";
import { hideTaskAndCollapseAncestors as hideGeneric } from "@features/task-buttons";

// Cache a per-App API instance to avoid repeated construction.
const apiCache = new WeakMap<
	App,
	ReturnType<typeof createObsidianTaskButtonsAPI>
>();

function getAPI(app: App) {
	let api = apiCache.get(app);
	if (!api) {
		api = createObsidianTaskButtonsAPI(app, eventBus);
		apiCache.set(app, api);
	}
	return api;
}

export function hideTaskAndCollapseAncestors(liEl: HTMLElement): void {
	hideGeneric(liEl);
}

export async function appendSnoozeButtonIfEligible(
	task: TaskItem,
	liEl: HTMLElement,
	sectionType: string,
	app: App,
	selectedAlias: string | null
): Promise<void> {
	const api = getAPI(app);
	await api.appendSnoozeButtonIfEligible(
		task,
		liEl,
		sectionType,
		selectedAlias ?? ""
	);
}

export async function appendSnoozeAllSubtasksButtonIfEligible(
	task: TaskItem,
	liEl: HTMLElement,
	sectionType: string,
	app: App,
	selectedAlias: string | null
): Promise<void> {
	const api = getAPI(app);
	await api.appendSnoozeAllSubtasksButtonIfEligible(
		task,
		liEl,
		sectionType,
		selectedAlias ?? ""
	);
}
