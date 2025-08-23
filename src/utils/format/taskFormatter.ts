type NormalizeOptions = {
	newAssigneeMark?: string | null;
	newDelegateMark?: string | null;
};

/**
 * Normalize a single Markdown task line to the canonical format:
 * - [status] {task text} {metadata <mark> tags} {assignee <mark>} → {delegate <mark>} {artifact link <mark> tags} {date tokens} ^{block ID}
 *
 * Rules:
 * - Status prefix is preserved (any status like [ ], [/], etc.).
 * - Extracts and keeps at most one assignee (👋...) and one delegate (🤝|👥|👤...).
 * - Metadata marks (anything not assignee/delegate/artifact) are kept and placed after text.
 * - Artifact marks are kept and placed after the assignee/delegate pair.
 * - Date tokens placed after artifact marks.
 * - Block ID is kept at the very end.
 * - If assignee is Everyone (class "*-team"), delegate is removed.
 * - If the normalized line ends with </mark>, ensure exactly one trailing space; otherwise trim trailing whitespace.
 */
export function normalizeTaskLine(
	line: string,
	opts: NormalizeOptions = {}
): string {
	try {
		// Prefix: "- [X] " or "* [/] ", status-agnostic, keep any indentation and bullet
		const m = /^(\s*[-*]\s*\[\s*.\s*\]\s*)([\s\S]*)$/.exec(line);
		if (!m) return line;
		const prefix = m[1];
		let rest = m[2];

		// Extract block ID (at end, like ^abc123). Keep exactly one, at the very end.
		let blockId: string | null = null;
		rest = rest.replace(
			/\s*\^([A-Za-z0-9-]+)\s*$/g,
			(_full, id: string) => {
				blockId = `^${id}`;
				return " ";
			}
		);

		// Extract date tokens from anywhere and remove from rest. Preserve order found.
		const dateTokenRe = /(?:🛫|⏳|📅|🎯|✅|❌)\s+\d{4}-\d{2}-\d{2}/g;
		const dateTokens = rest.match(dateTokenRe) ?? [];
		rest = rest.replace(dateTokenRe, " ");

		// Identify the various <mark> categories by their contents:
		// - Assignee: 👋
		// - Delegate: 🤝|👥|👤 (but exclude the special team assignee if matched via delegate regex)
		// - Artifact marks: marks that contain a link-only strong (e.g. <strong><a ...>...</a></strong>) or explicit indicators;
		//   we use a heuristic: if the inner <strong> contains an <a ...>, treat as artifact.
		// - Metadata marks: any other <mark> that is not assignee nor delegate nor artifact.

		// Generic mark matcher to iterate all marks
		const anyMarkRe =
			/<mark\b[^>]*>\s*<strong>[\s\S]*?<\/strong>\s*<\/mark>/gi;

		// Specific recognizers (do not use global state between calls)
		const isAssigneeMark = (s: string) =>
			/<strong>\s*👋[\s\S]*?<\/strong>/i.test(s);

		const isDelegateMark = (s: string) => {
			if (/<strong>\s*(?:🤝|👥|👤)[\s\S]*?<\/strong>/i.test(s)) {
				// But if class indicates team, treat that as assignee-Everyone and not a delegate
				if (/class="(?:active|inactive)-team"/i.test(s)) return false;
				return true;
			}
			return false;
		};

		const isEveryoneAssignee = (s: string) =>
			/\bclass="(?:active|inactive)-team"\b/i.test(s);

		const isArtifactMark = (s: string) =>
			/<strong>[\s\S]*?<a\b[^>]*>[\s\S]*?<\/a>[\s\S]*?<\/strong>/i.test(
				s
			);

		// Collect marks
		const metadataMarks: string[] = [];
		const artifactMarks: string[] = [];
		let foundAssignee: string | null = null;
		let foundDelegate: string | null = null;
		let foundEveryoneAssignee: string | null = null;

		// Iterate all marks, classify, and strip from rest
		rest = rest.replace(anyMarkRe, (mk: string) => {
			if (isAssigneeMark(mk)) {
				// First take precedence
				if (!foundAssignee) foundAssignee = mk;
				return " ";
			}
			if (isDelegateMark(mk)) {
				if (!foundDelegate) foundDelegate = mk;
				return " ";
			}
			if (isEveryoneAssignee(mk)) {
				if (!foundEveryoneAssignee) foundEveryoneAssignee = mk;
				return " ";
			}
			if (isArtifactMark(mk)) {
				artifactMarks.push(mk);
				return " ";
			}
			metadataMarks.push(mk);
			return " ";
		});

		// Remove stray arrows and collapse whitespace in the remaining text
		rest = rest.replace(/→/g, " ");
		rest = rest.replace(/\s{2,}/g, " ").trim();

		// Apply overrides if provided
		const hasOverrideAssignee = Object.prototype.hasOwnProperty.call(
			opts,
			"newAssigneeMark"
		);
		const hasOverrideDelegate = Object.prototype.hasOwnProperty.call(
			opts,
			"newDelegateMark"
		);

		const assigneeMark = hasOverrideAssignee
			? opts.newAssigneeMark ?? null
			: foundAssignee ?? foundEveryoneAssignee ?? null;

		let delegateMark = hasOverrideDelegate
			? opts.newDelegateMark ?? null
			: foundDelegate ?? null;

		// Special rule: if assignee is Everyone (alias exactly "team"), do not allow any delegation.
		const isEveryone =
			!!assigneeMark &&
			/\bclass="(?:active|inactive)-team"\b/i.test(assigneeMark);
		if (isEveryone) {
			delegateMark = null;
		}

		// Reassemble by canonical order:
		// - [status] {task text} {metadata marks} {assignee} → {delegate} {artifact marks} {date tokens} ^{blockId}
		let out = prefix + rest;

		// Metadata marks (in the order they were encountered)
		for (const m of metadataMarks) {
			out += (out.endsWith(" ") ? "" : " ") + m;
		}

		// Assignee
		if (assigneeMark) {
			out += (out.endsWith(" ") ? "" : " ") + assigneeMark;
		}

		// Delegate (with arrow)
		if (delegateMark) {
			out += " → " + delegateMark;
		}

		// Artifact marks (in the order they were encountered)
		for (const m of artifactMarks) {
			out += (out.endsWith(" ") ? "" : " ") + m;
		}

		// Date tokens
		if (dateTokens.length > 0) {
			out += (out.endsWith(" ") ? "" : " ") + dateTokens.join(" ");
		}

		// Block ID at the very end
		if (blockId) {
			out += (out.endsWith(" ") ? "" : " ") + blockId;
		}

		// Trailing space handling
		if (/<\/mark>\s*$/i.test(out)) {
			// If ending with a mark, enforce exactly one trailing space
			out = out.replace(/\s*$/, " ");
		} else {
			// Otherwise, trim trailing whitespace
			out = out.replace(/\s+$/g, "");
		}

		return out;
	} catch {
		return line;
	}
}
