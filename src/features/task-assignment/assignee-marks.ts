/**
 * Stateless helpers for working with assignment "marks" (<mark ...>...</mark>).
 *
 * In-app context:
 * - "Marks" are inline HTML blocks inside task lines that identify an assignee (👋) or other roles.
 * - These helpers are used by dynamic commands, the mark context menu, and cascade logic to read/write marks.
 *
 * Plugin value:
 * - Centralizes parsing and rendering rules for assignee marks so all features behave consistently.
 */

import { aliasToName } from "src/domain/slugs/slug-utils";
import { renderAssigneeMark } from "./mark-templates";

/**
 * Extract the explicit assignee alias from a single task line.
 *
 * In-app use:
 * - Used by commands, the mark context menu, and cascade logic to determine the current explicit assignee on a line.
 *
 * Plugin value:
 * - Allows higher-level features to reason about assignment state without duplicating regex parsing.
 *
 * @param line A single Markdown task line (may contain inline HTML marks).
 * @returns The explicit assignee alias (lowercased), or null if none found.
 */
export function getExplicitAssigneeAliasFromText(line: string): string | null {
	try {
		// Everyone (alias exactly "team")
		if (/\bclass="(?:active|inactive)-team"\b/i.test(line)) return "team";
		// Member assignee (👋 ...)
		const m =
			/\bclass="(?:active|inactive)-([a-z0-9-]+)"[^>]*>\s*<strong>👋/i.exec(
				line
			);
		return m ? m[1].toLowerCase() : null;
	} catch {
		return null;
	}
}

/**
 * Build an assignee mark (<mark ...>) for a given alias and variant.
 *
 * In-app use:
 * - Called by commands, context menus, and cascade logic to render standardized assignee marks.
 *
 * Plugin value:
 * - Ensures uniform HTML, colors, and semantics for the "Everyone" (team) assignment and named members.
 *
 * @param alias The assignee alias ("team" for Everyone, or a member alias).
 * @param variant "active" | "inactive" visual variant.
 * @param team The resolved team object for the current file (used to resolve member display names).
 * @returns HTML string for the assignee mark.
 */
export function buildAssigneeMarkForAlias(
	alias: string,
	variant: "active" | "inactive",
	team: any
): string {
	const lower = (alias || "").toLowerCase();

	if (lower === "team") {
		// Special case for "Everyone"
		return renderAssigneeMark("team", "Everyone", variant, {
			everyone: true,
		});
	}

	const member = (team?.members ?? []).find(
		(m: any) => (m.alias || "").toLowerCase() === lower
	);
	const name = member?.name || aliasToName(alias);
	return renderAssigneeMark(alias, name, variant, { everyone: false });
}
