/**
 * Identity & naming conventions shared across features.
 *
 * This module provides pure, feature-agnostic utilities for:
 * - Converting slug-like aliases into display-friendly names
 * - Creating slugs from human-readable names
 * - Escaping strings for safe use in RegExp sources
 * - Detecting and extracting trailing 6-character team/alias codes
 *
 * Conventions:
 * - Unicode dashes are normalized to ASCII hyphen-minus ("-") before processing.
 * - A double hyphen ("--") in aliases represents a literal hyphen character
 *   in the display name (i.e., "--" -> "-" in output), while single hyphens
 *   separate words.
 * - A trailing code of the form "-<digit><alnum>{5}" (e.g., "-1abc9z") denotes
 *   an identity suffix. In some contexts a code may be followed by additional
 *   segments (e.g., "-1abc9z-ext"). getDisplayNameFromAlias removes the code
 *   and anything after it if found. TEAM_CODE_RE matches the canonical trailing
 *   code (end-of-string).
 */

/**
 * Canonical regex for a trailing 6-character code suffix that starts with a digit.
 * Matches "-1abc9z" at the end of the string, capturing "1abc9z" in group 1.
 */
export const TEAM_CODE_RE = /-([0-9][a-z0-9]{5})$/i;

/**
 * Regex that detects a 6-character code suffix (same shape as TEAM_CODE_RE) that
 * may be followed by additional segments. Intended for stripping codes and any
 * trailing postfix (e.g., "-1abc9z-ext" or "-1abc9z-int").
 * Captures the code in group 1, but consumers generally use it for removal.
 */
const CODE_SUFFIX_WITH_TRAILING_SEGMENTS_RE = /-([0-9][a-z0-9]{5}).*$/i;

/**
 * Known postfix suffixes occasionally appended to aliases without codes.
 * These are stripped when no code suffix is present:
 * - "-ext", "-int", "-team"
 */
const KNOWN_POSTFIX_SUFFIX_RE = /-(?:ext|int|team)$/i;

/**
 * Normalizes various unicode dashes to ASCII hyphen-minus.
 */
function normalizeUnicodeDashes(input: string): string {
	// [‐‑‒–—―] covers common Unicode dash variants
	return input.replace(/[‐‑‒–—―]/g, "-");
}

/**
 * Converts a slug-like alias into a display-friendly name.
 *
 * Behavior:
 * - Trims input, returns "" for empty/whitespace input.
 * - Normalizes unicode dashes to "-".
 * - If a 6-char code suffix exists (e.g., "-1abc9z"), removes it AND anything after it,
 *   e.g., "some-team-1abc9z-ext" -> "some-team".
 * - If no code suffix exists, removes known postfixes "-ext", "-int", "-team".
 * - Interprets "--" as an escaped literal hyphen; single hyphens become spaces.
 * - Collapses whitespace and Title-Cases each word.
 *
 * Examples:
 * - "north-america-sales-1abc9z-ext" -> "North America Sales"
 * - "alpha--beta-team" -> "Alpha-Beta"
 * - "  MIXED—DASHES  " -> "Mixed Dashes"
 */
export function getDisplayNameFromAlias(alias: string): string {
	const raw = (alias || "").trim();
	if (!raw) return "";

	// Normalize unicode dashes first for consistent downstream handling
	let base = normalizeUnicodeDashes(raw).toLowerCase();

	// Remove the 6-char code and anything after it (e.g., "-4hj8jk-ext")
	const cutAfterCode = base.replace(
		CODE_SUFFIX_WITH_TRAILING_SEGMENTS_RE,
		""
	);
	if (cutAfterCode !== base) {
		base = cutAfterCode;
	} else {
		// If no code present, still strip known suffixes if they exist
		base = base.replace(KNOWN_POSTFIX_SUFFIX_RE, "");
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

/**
 * Basic slugify for names.
 *
 * Steps:
 * - Trim, lowercase
 * - Normalize unicode dashes to ASCII hyphen
 * - Replace whitespace runs with "-"
 * - Remove non [a-z0-9-]
 * - Compress multiple "-"
 * - Trim leading/trailing "-"
 *
 * Example:
 * - " Mixed—Case Name  " -> "mixed-case-name"
 */
export function slugifyName(input: string): string {
	let s = (input || "").trim().toLowerCase();

	// Replace unicode-ish hyphens with ASCII hyphen first
	s = normalizeUnicodeDashes(s);

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
 * Extracts the trailing 6-char code suffix from a slug if present.
 * Returns the code (e.g., "1abc9z") lowercased, or undefined if no suffix.
 *
 * Example:
 * - "north-america-sales-1AbC9Z" -> "1abc9z"
 * - "alpha-team" -> undefined
 */
export function extractCodeSuffix(slug: string): string | undefined {
	const m = TEAM_CODE_RE.exec(slug || "");
	return m?.[1]?.toLowerCase();
}
