export {
	findAncestor,
	getPathToAncestor,
	buildHierarchyFromPath,
	buildPrunedMergedTrees,
} from "./domain/bottom-up-builder";
export {
	attachFilteredChildren,
	buildFullSubtree,
} from "./domain/top-down-builder";

// New name for list-header bumping. stripListItems is exported as an alias
// from task-tree-utils for backwards compatibility.
export {
	bumpWhitelistedListItems,
} from "./domain/task-tree-utils";