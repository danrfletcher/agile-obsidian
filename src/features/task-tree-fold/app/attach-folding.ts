import type { App } from "obsidian";
import type { TaskItem } from "@features/task-index";
import { findSectionUls } from "../ui/dom-utils";
import { attachChevronSet } from "../ui/chevron-toggle";

/**
Lifecycle-aware event registration. Use Obsidian's registerDomEvent underneath.
*/
export type RegisterDomEvent = (
	el: HTMLElement | Window | Document,
	type: string,
	handler: (evt: Event) => void,
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
	 *
	 * IMPORTANT: Only use this for sections that truly want first-level gating
	 * (e.g., initiatives). Other sections should leave this undefined.
	 */
	firstLevelChildType?: string;

	/**
	 * Optional override for computing children for a given UID.
	 * Use for sections where "children" are not structural (e.g., Objectives' linked items).
	 */
	getChildren?: (uid: string) => TaskItem[];
}

/**
Public entrypoint: attach folding to a section (defaults to "initiatives").
First level can be constrained to an artifact type (e.g., "epic") when provided.

Note: We attach chevrons to ALL ULs belonging to the section so that bottom-level
items within nested trees get toggles (but only when they currently show no direct UL).
*/
export function attachSectionFolding(
	container: HTMLElement,
	options: AttachSectionFoldingOptions
) {
	const sectionName = options.sectionName ?? "initiatives";
	// Only apply first-level gating when explicitly provided by caller.
	const firstLevelChildType = options.firstLevelChildType;

	const sectionUls = findSectionUls(container, sectionName);
	if (sectionUls.length === 0) return;

	const deps = {
		app: options.app,
		taskMap: options.taskMap,
		childrenMap: options.childrenMap,
		selectedAlias: options.selectedAlias,
		renderTaskTree: options.renderTaskTree,
		registerDomEvent: options.registerDomEvent,
	};

	// Attach to all ULs for this section so we can place toggles on bottom-level nodes throughout.
	sectionUls.forEach((ul, idx) => {
		attachChevronSet(ul, deps, {
			childrenType: idx === 0 ? firstLevelChildType : undefined,
			sectionName,
			getChildren: options.getChildren, // Propagate optional override
		});
	});
}