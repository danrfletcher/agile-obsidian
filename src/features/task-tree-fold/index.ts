/**
 * Task Tree Fold Module
 * Used by agile-dashboard-view to display folding task trees in sections e.g., initiatives section.
 * Potentially used in future sections to display more interactive task trees.
 *
 * Barrel for task-tree-fold public API.
 *
 */

import { attachSectionFolding } from "./app/attach-folding";

export { attachSectionFolding };
export type {
	AttachSectionFoldingOptions,
	RegisterDomEvent,
} from "./app/attach-folding";

/**
 * Convenience alias for the common initiatives use-case.
 * Defaults: sectionName="initiatives", firstLevelChildType="epic".
 */
export function attachInitiativesFolding(
	container: HTMLElement,
	options: import("./app/attach-folding").AttachSectionFoldingOptions
) {
	return attachSectionFolding(container, {
		...options,
		sectionName: options.sectionName ?? "initiatives",
		firstLevelChildType: options.firstLevelChildType ?? "epic",
	});
}
