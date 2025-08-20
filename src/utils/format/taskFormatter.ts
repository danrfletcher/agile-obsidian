
type NormalizeOptions = {
	newAssigneeMark?: string | null;
	newDelegateMark?: string | null;
};

/**
 * Normalize a single Markdown task line to the canonical format:
 * - [ ] [task text & any html other than assignee/delegate] [assignee] → [delegate] [date tokens]
 *
 * Notes:
 * - Ensures at most one assignee (👋 ...) and one delegate (🤝|👥|👤 ...).
 * - Places the assignee and delegate together at the end of the task text, before any date tokens.
 * - Preserves indentation and the "- [ ] " prefix.
 */
export function normalizeTaskLine(line: string, opts: NormalizeOptions = {}): string {
	try {
		const m = /^(\s*-\s\[\s*.\s*\]\s*)([\s\S]*)$/.exec(line);
		if (!m) return line;
		const prefix = m[1];
		let rest = m[2];

		// Collect date tokens and remove them from the rest of the text.
		const dateTokenRe = /(?:🛫|⏳|📅|🎯|✅|❌)\s+\d{4}-\d{2}-\d{2}/g;
		const dateTokens = rest.match(dateTokenRe) ?? [];
		rest = rest.replace(dateTokenRe, " ");

		// Extract marks
		const assignRe = /<mark\s+class="(?:active|inactive)-[a-z0-9-]+"[^>]*>\s*<strong>👋[\s\S]*?<\/strong>\s*<\/mark>/gi;
		const delegRe = /<mark\s+class="(?:active|inactive)-[a-z0-9-]+"[^>]*>\s*<strong>(?:🤝|👥|👤)[\s\S]*?<\/strong>\s*<\/mark>/gi;
		const everyoneRe = /<mark\s+class="(?:active|inactive)-team"[^>]*>\s*<strong>[\s\S]*?<\/strong>\s*<\/mark>/i;

		let foundAssignee: string | null = null;
		let foundDelegate: string | null = null;
		let foundEveryoneAssignee: string | null = null;

		const firstMatch = (re: RegExp, s: string): string | null => {
			re.lastIndex = 0;
			const mm = re.exec(s);
			return mm ? mm[0] : null;
		};

		foundAssignee = firstMatch(assignRe, rest);
		foundEveryoneAssignee = firstMatch(everyoneRe, rest);
		foundDelegate = firstMatch(delegRe, rest);
		// If the detected delegate is actually the special 'Everyone' alias (class "...-team"), ignore it as a delegate
		if (foundDelegate && /class="(?:active|inactive)-team"/i.test(foundDelegate)) {
			foundDelegate = null;
		}

		// Remove all assignment and delegation marks, and any arrows, from the text content
		rest = rest.replace(assignRe, " ");
		rest = rest.replace(delegRe, " ");
		rest = rest.replace(/→/g, " ");

		// Collapse internal whitespace
		rest = rest.replace(/\s{2,}/g, " ").trim();

		// Decide which marks to render (presence of override allows explicit removal by passing null)
		const hasOverrideAssignee = Object.prototype.hasOwnProperty.call(opts, "newAssigneeMark");
		const hasOverrideDelegate = Object.prototype.hasOwnProperty.call(opts, "newDelegateMark");
		const assigneeMark = hasOverrideAssignee
			? (opts.newAssigneeMark ?? null)
			: (foundAssignee ?? foundEveryoneAssignee ?? null);
		let delegateMark = hasOverrideDelegate
			? (opts.newDelegateMark ?? null)
			: (foundDelegate ?? null);

		// Special rule: if assigned to Everyone (alias exactly "team"), do not allow any delegation.
		const isEveryone = !!assigneeMark && /\bclass="(?:active|inactive)-team"\b/i.test(assigneeMark);
		if (isEveryone) {
			delegateMark = null;
		}

		// Build normalized line
		let out = prefix + rest;

		if (assigneeMark) {
			out += (rest ? " " : " ") + assigneeMark;
		}

		if (delegateMark) {
			out += " → " + delegateMark;
		}

		if (dateTokens.length > 0) {
			out += (out.endsWith(" ") || out.endsWith("\t")) ? "" : " ";
			out += dateTokens.join(" ");
		}

		// If the normalized line ends with a </mark>, ensure exactly one trailing space
		// so Live Preview doesn't open the HTML block when clicking at line end.
		if (/<\/mark>\s*$/i.test(out)) {
			out = out.replace(/\s*$/, " ");
		} else {
			// Otherwise, trim trailing whitespace.
			out = out.replace(/\s+$/g, "");
		}

		return out;
	} catch {
		return line;
	}
}
