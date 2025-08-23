/**
 * Centralized templates for generating <mark ...> HTML blocks.
 *
 * In-app context:
 * - Used by assignee/delegate features to render consistent marks inside task lines.
 *
 * Plugin value:
 * - Single source of truth for markup, emojis, and colors used across commands, menus, and cascades.
 */

// Local helper for visible label formatting
const toTitleCase = (s: string) =>
	s.replace(
		/\S+/g,
		(w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
	);

/**
 * Render an assignee mark.
 *
 * Notes:
 * - "Everyone" is represented by alias "team" and displays 🤝 Everyone with a neutral background.
 * - Regular members use 👋 and a green-ish background when active.
 *
 * @param alias The assignee alias ("team" for Everyone, or a member alias).
 * @param displayName The human-readable name (derived from settings or alias).
 * @param variant "active" | "inactive" visual variant.
 * @param opts Options including whether this is the Everyone pseudo-member.
 */
export function renderAssigneeMark(
	alias: string,
	displayName: string,
	variant: "active" | "inactive",
	opts: { everyone: boolean }
): string {
	if (opts.everyone) {
		const bg = variant === "active" ? "#FFFFFF" : "#CACFD9A6";
		// Everyone uses a fixed label
		return `<mark class="${variant}-team" style="background: ${bg}; color: #000000"><strong>🤝 Everyone</strong></mark>`;
	}

	const bg = variant === "active" ? "#BBFABBA6" : "#CACFD9A6";
	const label = toTitleCase(getDisplayNameFromAlias(displayName || alias));

	return `<mark class="${variant}-${alias}" style="background: ${bg};"><strong>👋 ${label}</strong></mark>`;
}

/**
 * Render a delegate mark.
 *
 * Notes:
 * - Delegation marks are always considered "active" visually in current UI flows,
 *   but we accept variant for compatibility.
 *
 * @param alias Target alias (e.g., internal/external/team aliases).
 * @param displayName Target display name.
 * @param variant "active" | "inactive".
 * @param targetType "team" | "internal" | "external" affects emoji and color.
 */
export function renderDelegateMark(
	alias: string,
	displayName: string,
	variant: "active" | "inactive",
	targetType: "team" | "internal" | "external"
): string {
	const emoji =
		targetType === "team" ? "🤝" : targetType === "internal" ? "👥" : "👤";
	const bg =
		variant === "active"
			? targetType === "team"
				? "#008080"
				: targetType === "internal"
				? "#687D70"
				: "#FA9684"
			: "#CACFD9A6";

	const label = toTitleCase(displayName || "");

	return `<mark class="${variant}-${alias}" style="background: ${bg};"><strong>${emoji} ${label}</strong></mark>`;
}
