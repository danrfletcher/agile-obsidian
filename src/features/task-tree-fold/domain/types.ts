import type { App } from "obsidian";

/**
 * Minimal task shape consumed by this module.
 * Adapter can map your TaskItem to BaseTask.
 */
export interface BaseTask {
	_uniqueId?: string | null;
	status?: string | null;
	position?: {
		start?: {
			line?: number | null;
		} | null;
	} | null;
}

/**
 * Common options passed when rendering a tree.
 */
export interface RenderContext<TTask extends BaseTask = BaseTask> {
	tasks: TTask[];
	container: HTMLElement;
	app: App;
	depth: number;
	isRoot: boolean;
	sectionType: string;
	selectedAlias: string | null;
}
