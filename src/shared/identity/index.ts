/**
 * Public API for shared identity utilities.
 *
 * See JSDoc in the domain module for behavior details and examples.
 */
export {
	getDisplayNameFromAlias,
	slugifyName,
	escapeRegExp,
	TEAM_CODE_RE,
	extractCodeSuffix,
} from "./domain/alias-slug-model";
