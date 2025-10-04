import type { App } from "obsidian";
import type { TaskItem } from "@features/task-index";
import { findSectionUl } from "../ui/dom-utils";
import { attachChevronSet } from "../ui/chevron-toggle";

/**
 * Lifecycle-aware event registration. Use Obsidian's registerDomEvent underneath.
 */
export type RegisterDomEvent = (
	el: HTMLElement | Window | Document,
	type: string,
	handler: (evt: any) => void,
	options?: AddEventListenerOptions | boolean
) => void;

export interface AttachSectionFoldingOptions {
	app: App;
	taskMap: Map<string, TaskItem>;
	childrenMap: Map<string, TaskItem[]>;
	selectedAlias: string | null;
	renderTaskTree: (
		tasks: TaskItem[],
		container: HTMLElement,
		app: App,
		depth: number,
		isRoot: boolean,
		sectionType: string,
		selectedAlias: string | null
	) => void;
	registerDomEvent?: RegisterDomEvent;

	/**
	 * UL section name to target, defaults to "initiatives".
	 */
	sectionName?: string;

	/**
	 * Child artifact type to expand at first level (e.g., "epic").
	 * If omitted, expands all types.
	 */
	firstLevelChildType?: string;
}

/**
 * Public entrypoint: attach folding to a section (defaults to "initiatives").
 * First level can be constrained to an artifact type (defaults to "epic").
 */
export function attachSectionFolding(
	container: HTMLElement,
	options: AttachSectionFoldingOptions
) {
	const sectionName = options.sectionName ?? "initiatives";
	const firstLevelChildType = options.firstLevelChildType ?? "epic";

	const sectionUl = findSectionUl(container, sectionName);
	if (!sectionUl) return;

	const deps = {
		app: options.app,
		taskMap: options.taskMap,
		childrenMap: options.childrenMap,
		selectedAlias: options.selectedAlias,
		renderTaskTree: options.renderTaskTree,
		registerDomEvent: options.registerDomEvent,
	};

	attachChevronSet(sectionUl, deps, {
		childrenType: firstLevelChildType,
		sectionName,
	});
}
