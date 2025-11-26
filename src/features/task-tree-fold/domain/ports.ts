import type { App } from "obsidian";
import type { BaseTask, RenderContext } from "./types";

/**
 * Lifecycle-aware event registration. Use Obsidian's registerDomEvent underneath.
 */
export type RegisterDomEvent = (
	el: HTMLElement | Window | Document,
	type: string,
	handler: (evt: Event) => void,
	options?: AddEventListenerOptions | boolean
) => void;

/**
 * Port to interact with tasks, filtering, and classification.
 * Adapter should implement these using your TaskItem + maps, filters, etc.
 */
export interface TaskOpsPort<TTask extends BaseTask = BaseTask> {
	getDirectChildren: (uid: string) => TTask[];
	isCompleted: (task: TTask) => boolean;
	isCancelled: (task: TTask) => boolean;
	/**
	 * Return a domain-specific artifact type (e.g., "epic", "story", etc.)
	 */
	getArtifactType?: (task: TTask) => string | undefined;
	/**
	 * Optional comparator to override default sorting.
	 */
	sortComparator?: (a: TTask, b: TTask) => number;
}

/**
 * Port for building pruned/merged (top-only) trees from flat inputs.
 */
export interface TaskTreeBuilderPort<TTask extends BaseTask = BaseTask> {
	buildPrunedMergedTrees: (
		items: TTask[],
		options: { depth: number }
	) => TTask[];
}

/**
 * Port for rendering the tree into a container.
 */
export interface TaskTreeRendererPort<TTask extends BaseTask = BaseTask> {
	renderTaskTree: (ctx: RenderContext<TTask>) => void;
}

/**
 * Port for lifecycle-aware event registration.
 */
export interface DomLifecyclePort {
	registerDomEvent: RegisterDomEvent;
}

export interface TaskTreeFoldDependencies<TTask extends BaseTask = BaseTask> {
	app: App;
	selectedAlias: string | null;
	tasks: TaskOpsPort<TTask>;
	treeBuilder: TaskTreeBuilderPort<TTask>;
	renderer: TaskTreeRendererPort<TTask>;
	lifecycle: DomLifecyclePort;
}

export interface AttachOptions {
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