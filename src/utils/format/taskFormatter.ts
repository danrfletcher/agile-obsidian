type NormalizeOptions = {
	newAssigneeMark?: string | null;
	newDelegateMark?: string | null;
};

/**
 * Normalize a single Markdown task line to the canonical format:
 * - [status] {task text} {metadata <mark> tags} {assignee <mark>} → {delegate <mark>} {artifact link <mark> tags} {date tokens} ^{block ID}
 */
export function normalizeTaskLine(
	line: string,
	opts: NormalizeOptions = {}
): string {
	try {
		// Prefix: "- [X] " or "* [/] ", status-agnostic
		const m = /^(\s*[-*]\s*\[\s*.\s*\]\s*)([\s\S]*)$/.exec(line);
		if (!m) return line;
		const prefix = m[1];
		let rest = m[2];

		// Block ID at end
		let blockId: string | null = null;
		rest = rest.replace(
			/\s*\^([A-Za-z0-9-]+)\s*$/g,
			(_full, id: string) => {
				blockId = `^${id}`;
				return " ";
			}
		);

		// Date tokens (preserve order)
		const dateTokenRe = /(?:🛫|⏳|📅|🎯|✅|❌)\s+\d{4}-\d{2}-\d{2}/g;
		const dateTokens = rest.match(dateTokenRe) ?? [];
		rest = rest.replace(dateTokenRe, " ");

		// Mark classifiers
		const anyMarkRe =
			/<mark\b[^>]*>\s*<strong>[\s\S]*?<\/strong>\s*<\/mark>/gi;
		const isAssigneeMark = (s: string) =>
			/<strong>\s*👋[\s\S]*?<\/strong>/i.test(s);
		const isDelegateMark = (s: string) => {
			if (/<strong>\s*(?:🤝|👥|👤)[\s\S]*?<\/strong>/i.test(s)) {
				// exclude 'Everyone' (team) which is assignee-special
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

		// Strip and classify marks from rest
		rest = rest.replace(anyMarkRe, (mk: string) => {
			if (isAssigneeMark(mk)) {
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

		// Clean arrows and whitespace in text
		rest = rest.replace(/→/g, " ");
		rest = rest.replace(/\s{2,}/g, " ").trim();

		// Apply overrides:
		// IMPORTANT FIX: If opts has newAssigneeMark (even if null), it fully overrides ANY found assignee (including 'Everyone').
		const hasOverrideAssignee = Object.prototype.hasOwnProperty.call(
			opts,
			"newAssigneeMark"
		);
		const hasOverrideDelegate = Object.prototype.hasOwnProperty.call(
			opts,
			"newDelegateMark"
		);

		const assigneeMark = hasOverrideAssignee
			? opts.newAssigneeMark ?? null // explicit override wins and can remove assignee
			: foundAssignee ?? foundEveryoneAssignee ?? null; // fallback to detected assignee/Everyone

		let delegateMark = hasOverrideDelegate
			? opts.newDelegateMark ?? null
			: foundDelegate ?? null;

		// Special rule: if chosen assignee is Everyone, remove delegate
		const isEveryone =
			!!assigneeMark &&
			/\bclass="(?:active|inactive)-team"\b/i.test(assigneeMark);
		if (isEveryone) {
			delegateMark = null;
		}

		// Reassemble by canonical order:
		// - [status] {task text} {metadata marks} {assignee} → {delegate} {artifact marks} {date tokens} ^{blockId}
		let out = prefix + rest;

		for (const m of metadataMarks) {
			out += (out.endsWith(" ") ? "" : " ") + m;
		}

		if (assigneeMark) {
			out += (out.endsWith(" ") ? "" : " ") + assigneeMark;
		}

		if (delegateMark) {
			out += " → " + delegateMark;
		}

		for (const m of artifactMarks) {
			out += (out.endsWith(" ") ? "" : " ") + m;
		}

		if (dateTokens.length > 0) {
			out += (out.endsWith(" ") ? "" : " ") + dateTokens.join(" ");
		}

		if (blockId) {
			out += (out.endsWith(" ") ? "" : " ") + blockId;
		}

		// Trailing space handling: keep one space if ending with </mark>
		if (/<\/mark>\s*$/i.test(out)) {
			out = out.replace(/\s*$/, " ");
		} else {
			out = out.replace(/\s+$/g, "");
		}

		return out;
	} catch {
		return line;
	}
}
