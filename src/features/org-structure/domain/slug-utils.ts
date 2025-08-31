/**
 * Team/org slug utilities
 *
 * Team folder naming convention:
 *   "<Team Name> (<team-slug>)"
 *
 * team-slug format:
 *   "<name-slug>[-<pathId>]-<code>"
 *
 * Where:
 *   - name-slug = team name lowercased, spaces -> hyphens, non [a-z0-9-] removed, compress hyphens
 *   - pathId    = optional string for org/subteam path segments e.g. "a", "a-1", "b-2-3"
 *   - code      = a 6-character code starting with a digit: [0-9][a-z0-9]{5}
 *
 * Resource files/dirs naming:
 *   "Initiatives (initiatives[-<pathId>]-<code>).md" or folder "Initiatives (initiatives[-<pathId>]-<code>)"
 *   "Priorities (priorities[-<pathId>]-<code>).md"
 *   "Completed (completed[-<pathId>]-<code>).md"
 */

/**
 * Generates a random 6-character team code starting with a digit.
 */
function generateShortCode(): string {
	const first = Math.floor(Math.random() * 10).toString(); // 0-9
	const rest = Array.from({ length: 5 })
		.map(() => Math.floor(Math.random() * 36).toString(36))
		.join("");
	return (first + rest).toLowerCase();
}

/**
 * Escape a string for safe use in RegExp sources.
 */
export function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Basic slugify for team names
 */
export function slugifyName(input: string): string {
	let s = (input || "").trim().toLowerCase();
	// Replace unicode-ish hyphens with ASCII hyphen
	s = s.replace(/[‐‑‒–—―]/g, "-");
	// Replace whitespace with hyphen
	s = s.replace(/\s+/g, "-");
	// Remove invalids
	s = s.replace(/[^a-z0-9-]/g, "");
	// Compress multiple hyphens
	s = s.replace(/-+/g, "-");
	// Trim hyphens
	s = s.replace(/^-+/, "").replace(/-+$/, "");
	return s;
}

/**
 * Build a team slug from parts.
 */
export function buildTeamSlug(
	teamName: string,
	code: string | null,
	pathId?: string | null
): string {
	code ??= generateShortCode(); // assigns only if code is null or undefined
	const base = slugifyName(teamName);
	return pathId ? `${base}-${pathId}-${code}` : `${base}-${code}`;
}

/**
 * Build a child team/subteam slug under an organization, preserving the org base name
 * and appending hierarchical path segments before the code:
 *   "<org-name-slug>[-<segment>...]-<code>"
 *
 * Examples:
 *   buildOrgChildSlug("Nueral", "6fg1hj", "a")           => "nueral-a-6fg1hj"
 *   buildOrgChildSlug("Nueral", "6fg1hj", ["a", "1"])    => "nueral-a-1-6fg1hj"
 */
export function buildOrgChildSlug(
	orgName: string,
	code: string,
	pathId?: string | string[] | null
): string {
	const base = slugifyName(orgName);
	const pid = Array.isArray(pathId)
		? pathId.filter(Boolean).join("-")
		: pathId || null;
	return pid ? `${base}-${pid}-${code}` : `${base}-${code}`;
}

/**
 * Parse a folder name "<Name> (<slug>)" to {name, slug, pathId, code, baseNameSlug}.
 * Returns null if not a match or invalid code.
 */
export function parseTeamFolderName(
	folderName: string
): { name: string; slug: string } | null {
	const m = /^(.+?)\s*\(([^)]+)\)$/.exec(folderName);
	if (!m) return null;
	const name = m[1].trim();
	const slug = m[2].trim();
	if (!name || !slug) return null;
	return { name, slug };
}

export function getBaseCodeFromSlug(slug: string): string | null {
	const m = /-([0-9][a-z0-9]{5})$/i.exec(slug);
	return m ? m[1].toLowerCase() : null;
}

export function getPathIdFromSlug(
	slug: string,
	expectedBaseNameSlug?: string
): string | null {
	const code = getBaseCodeFromSlug(slug);
	if (!code) return null;
	const left = slug.slice(0, -1 * (code.length + 1));
	if (expectedBaseNameSlug) {
		if (left === expectedBaseNameSlug) return null;
		if (left.startsWith(expectedBaseNameSlug + "-"))
			return left.slice(expectedBaseNameSlug.length + 1);
		return null;
	}
	const parts = left.split("-");
	return parts.length > 1 ? parts.slice(1).join("-") : null;
}

/**
 * Resource slug builder and parser
 */
function buildResourceSlug(
	kind: "initiatives" | "priorities" | "completed",
	code: string,
	pathId?: string | null
): string {
	return pathId ? `${kind}-${pathId}-${code}` : `${kind}-${code}`;
}

function resourceKindToTitle(
	kind: "initiatives" | "priorities" | "completed"
): string {
	return kind === "initiatives"
		? "Initiatives"
		: kind === "priorities"
		? "Priorities"
		: "Completed";
}

export function buildResourceFileName(
	kind: "initiatives" | "priorities" | "completed",
	code: string,
	pathId?: string | null
): string {
	const title = resourceKindToTitle(kind);
	const slug = buildResourceSlug(kind, code, pathId);
	return `${title} (${slug}).md`;
}

export function buildResourceFolderName(
	kind: "initiatives",
	code: string,
	pathId?: string | null
): string {
	// Only Initiatives has a sample folder in our convention
	const title = resourceKindToTitle(kind);
	const slug = buildResourceSlug(kind, code, pathId);
	return `${title} (${slug})`;
}

export function isTeamFolderName(name: string): boolean {
	return (
		/^.+\s+\([a-z0-9-]+\)$/i.test(name) &&
		/-([0-9][a-z0-9]{5})\)$/i.test(name)
	);
}

/**
 * Resolve the team metadata for a given file path from a list of teams.
 * Picks the deepest matching rootPath; fallback tolerates "Name (slug)" segment.
 */
export function resolveTeamForPath(filePath: string, teams: any[]): any | null {
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

		// Fallback: tolerate "Name (slug)" folder segments that include name at the start.
		const segments = filePath.split("/").filter(Boolean);
		for (const t of teams) {
			const tName = (t.name || "").trim();
			if (!tName) continue;
			if (
				segments.some(
					(seg) => seg === tName || seg.startsWith(`${tName} (`)
				)
			) {
				return t;
			}
		}
		return null;
	} catch {
		return null;
	}
}

export function getDisplayNameFromAlias(alias: string): string {
	const raw = (alias || "").trim();
	if (!raw) return "";

	// Normalize to lower for consistent processing
	let base = raw.toLowerCase();

	// Remove the 6-char code and anything after it (e.g., "-4hj8jk-ext")
	const cutAfterCode = base.replace(/-[0-9][a-z0-9]{5}.*$/i, "");
	if (cutAfterCode !== base) {
		base = cutAfterCode;
	} else {
		// If no code present, still strip known suffixes if they exist
		base = base.replace(/-(?:ext|int|team)$/i, "");
	}

	// Preserve original hyphens that were intentionally doubled ("--" -> literal hyphen),
	// and convert remaining hyphens to spaces.
	const TOKEN = "<<<H>>>";
	base = base.replace(/--/g, TOKEN);
	base = base.replace(/-/g, " ");
	base = base.replace(new RegExp(TOKEN, "g"), "-");

	// Collapse whitespace and Title-Case each word
	base = base.replace(/\s+/g, " ").trim();
	if (!base) return "";

	return base
		.split(" ")
		.map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ""))
		.join(" ");
}
