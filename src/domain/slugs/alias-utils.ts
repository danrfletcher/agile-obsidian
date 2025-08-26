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
