import { App, MarkdownView } from "obsidian";

/**
 * Escape a string for safe use in RegExp sources.
 */
export function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Checks whether a line is an unchecked Markdown task "- [ ] ".
 */
export function isUncheckedTaskLine(line: string): boolean {
	return /^\s*-\s\[\s\]\s/.test(line);
}

/**
 * Returns the active file path or null.
 */
export function getActiveFilePath(app: App): string | null {
	const view = app.workspace.getActiveViewOfType(MarkdownView);
	const file = view?.file ?? null;
	return file ? file.path : null;
}

/**
 * Resolve the team metadata for a given file path from a list of teams.
 * Picks the deepest matching rootPath; falls back to matching a path segment by team name.
 */
export function resolveTeamForPath(
	filePath: string,
	teams: any[]
): any | null {
	try {
		if (!filePath || !teams || teams.length === 0) return null;

		// Prefer rootPath match (deepest)
		let best: any = null;
		let bestLen = -1;
		for (const t of teams) {
			const root = (t.rootPath || "").replace(/\/+$/g, "");
			if (!root) continue;
			if (filePath === root || filePath.startsWith(root + "/")) {
				if (root.length > bestLen) {
					best = t;
					bestLen = root.length;
				}
			}
		}
		if (best) return best;

		// Fallback: any segment equals team name
		const segments = filePath.split("/").filter(Boolean);
		for (const t of teams) {
			if (segments.includes(t.name)) return t;
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Returns true if the line contains an assignment to any (non -ext/-team/-int) member of the team.
 */
export function hasAnyTeamMemberAssignment(line: string, team: any): boolean {
	const members: any[] = (team?.members ?? []).filter((m: any) => {
		const a = (m.alias || "").toLowerCase();
		return a && !a.endsWith("-ext") && !a.endsWith("-team") && !a.endsWith("-int");
	});
	if (members.length === 0) return false;
	const choices = members.map((m) => escapeRegExp(m.alias)).join("|");
	const re = new RegExp(`<mark\\s+class="(?:active|inactive)-(?:${choices})"`, "i");
	return re.test(line);
}

/**
 * Convert an alias (possibly with suffixes and double-hyphen encoding) back to a display name.
 */
export function aliasToName(alias: string): string {
	let normalized = alias;
	const lower = alias.toLowerCase();
	if (lower.endsWith("-ext")) normalized = alias.slice(0, -4);
	else if (lower.endsWith("-team")) normalized = alias.slice(0, -5);
	else if (lower.endsWith("-int")) normalized = alias.slice(0, -4);
	const m = /^([a-z0-9-]+)-([0-9][a-z0-9]{5})$/i.exec(normalized);
	const base = (m ? m[1] : normalized).toLowerCase();

	// Parse into tokens, where '-' separates tokens, and '--' inserts a literal hyphen
	const tokens: string[] = [""];
	for (let i = 0; i < base.length; i++) {
		const ch = base[i];
		if (ch === "-") {
			if (i + 1 < base.length && base[i + 1] === "-") {
				// literal hyphen inside the current token
				tokens[tokens.length - 1] += "-";
				i++; // skip the second '-'
			} else {
				// token separator
				tokens.push("");
			}
		} else {
			tokens[tokens.length - 1] += ch;
		}
	}
	const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
	return tokens.filter(Boolean).map(cap).join(" ");
}
