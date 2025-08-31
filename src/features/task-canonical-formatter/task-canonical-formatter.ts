type NormalizeOptions = {
	newAssigneeMark?: string | null;
	newDelegateMark?: string | null;
};

/**
 * Normalize a single Markdown task line to the canonical format:
 * - [status] {artifact item type} {task text} {metadata <mark> tags} {assignee <mark>} → {delegate <mark>} {artifact link <mark> tags} {date tokens} ^{block ID}
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

		// Enhanced date token extraction with priority ordering
		const dateTokens = extractAndOrderDateTokens(rest);
		rest = removeDateTokensFromText(rest);

		// Mark classifiers
		const anyMarkRe =
			/<mark\b[^>]*>\s*<strong>[\s\S]*?<\/strong>\s*<\/mark>/gi;
		
		const isArtifactItemTypeMark = (s: string) =>
			/\bclass=["'][^"']*\bartifact-item-type\b[^"']*["']/i.test(s);
		
		const isMetadataMarkTag = (s: string) => {
			const match = /\bclass=["'][^"']*\bmetadata-mark-tag-([^"'\s]+)\b[^"']*["']/i.exec(s);
			return match ? match[1] : null;
		};
		
		const isArtifactLinkMark = (s: string) => {
			const match = /\bclass=["'][^"']*\bartifact-link-([^"'\s]+)\b[^"']*["']/i.exec(s);
			return match ? match[1] : null;
		};
		
		const isAssigneeMark = (s: string) =>
			/<strong>\s*👋[\s\S]*?<\/strong>/i.test(s);
		
		const isDelegateMark = (s: string) => {
			if (/<strong>\s*(?:🤝|👥|👤)[\s\S]*?<\/strong>/i.test(s)) {
				// exclude 'Everyone' (team) which is assignee-special
				if (isEveryoneAssignee(s)) return false;
				return true;
			}
			return false;
		};
		
		const isEveryoneAssignee = (s: string) =>
			/<mark\b[^>]*\bclass=["'][^"']*\b(?:active|inactive)-team\b[^"']*["'][^>]*>/i.test(s) ||
			/<strong>[\s\S]*?Everyone[\s\S]*?<\/strong>/i.test(s);

		// Collect marks by type
		let artifactItemTypeMark: string | null = null;
		const metadataMarks: Array<{mark: string, name: string}> = [];
		const artifactLinkMarks: Array<{mark: string, name: string}> = [];
		let foundAssignee: string | null = null;
		let foundDelegate: string | null = null;
		let foundEveryoneAssignee: string | null = null;

		// Strip and classify marks from rest
		rest = rest.replace(anyMarkRe, (mk: string) => {
			if (isArtifactItemTypeMark(mk)) {
				if (!artifactItemTypeMark) artifactItemTypeMark = mk;
				return " ";
			}
			
			const metadataName = isMetadataMarkTag(mk);
			if (metadataName) {
				metadataMarks.push({mark: mk, name: metadataName});
				return " ";
			}
			
			const artifactLinkName = isArtifactLinkMark(mk);
			if (artifactLinkName) {
				artifactLinkMarks.push({mark: mk, name: artifactLinkName});
				return " ";
			}
			
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
			
			// Fallback: treat as metadata mark if no specific classification
			metadataMarks.push({mark: mk, name: 'unknown'});
			return " ";
		});

		// Sort metadata marks alphabetically by name
		metadataMarks.sort((a, b) => a.name.localeCompare(b.name));

		// Sort artifact link marks: 'okr' first, then alphabetically
		artifactLinkMarks.sort((a, b) => {
			if (a.name === 'okr' && b.name !== 'okr') return -1;
			if (b.name === 'okr' && a.name !== 'okr') return 1;
			return a.name.localeCompare(b.name);
		});

		// Clean arrows and whitespace in text
		rest = rest.replace(/→/g, " ");
		rest = rest.replace(/\s{2,}/g, " ").trim();

		// Apply overrides:
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

		// Special rule: if chosen assignee is Everyone, remove delegate
		const isEveryone =
			!!assigneeMark &&
			/\bclass="(?:active|inactive)-team"\b/i.test(assigneeMark);
		if (isEveryone) {
			delegateMark = null;
		}

		// If no assignee is present, delegates are invalid and must be removed
		if (!assigneeMark) {
			delegateMark = null;
		}

		// If overriding assignee, ensure no stray assignee/everyone marks remain in metadata marks
		if (hasOverrideAssignee) {
			const filtered = metadataMarks.filter(
				(m) => !isAssigneeMark(m.mark) && !isEveryoneAssignee(m.mark)
			);
			metadataMarks.length = 0;
			metadataMarks.push(...filtered);
		}

		// Reassemble by canonical order:
		// - [status] {artifact item type} {task text} {metadata marks} {assignee} → {delegate} {artifact marks} {date tokens} ^{blockId}
		let out = prefix;

		// Add artifact item type first if present
		if (artifactItemTypeMark) {
			out += artifactItemTypeMark;
			if (rest.trim()) {
				out += " " + rest;
			}
		} else {
			out += rest;
		}

		// Add metadata marks
		for (const m of metadataMarks) {
			out += (out.endsWith(" ") ? "" : " ") + m.mark;
		}

		// Add assignee
		if (assigneeMark) {
			out += (out.endsWith(" ") ? "" : " ") + assigneeMark;
		}

		// Add delegate
		if (delegateMark) {
			out += " → " + delegateMark;
		}

		// Add artifact link marks
		for (const m of artifactLinkMarks) {
			out += (out.endsWith(" ") ? "" : " ") + m.mark;
		}

		// Add date tokens
		if (dateTokens.length > 0) {
			out += (out.endsWith(" ") ? "" : " ") + dateTokens.join(" ");
		}

		// Add block ID
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

/**
 * Extract and order date tokens according to priority
 */
function extractAndOrderDateTokens(text: string): string[] {
	const dateTokens: Array<{token: string, priority: number}> = [];
	
	// Define priority order
	const priorities = {
		'🛫': 1, // Start date
		'⏳': 2, // Scheduled date
		'📅': 3, // Due date
		'🎯': 4, // Target date
		'💤': 5, // Snooze date (including folder variants)
		'💤⬇️': 6, // Snooze all subtasks (including folder variants)
		'✅': 7, // Completed date
		'❌': 8  // Cancelled date
	};

	// Standard date tokens with dates
	const standardDateRe = /(🛫|⏳|📅|🎯|✅|❌)\s+\d{4}-\d{2}-\d{2}/g;
	let match;
	while ((match = standardDateRe.exec(text)) !== null) {
		const emoji = match[1] as keyof typeof priorities;
		dateTokens.push({
			token: match[0],
			priority: priorities[emoji]
		});
	}

	// Snooze tokens - various formats
	// 1. Simple snooze with individual date: 💤<span style="display: none">username</span> YYYY-MM-DD
	const snoozeIndividualRe = /💤<span style="display: none">([^<]+)<\/span>\s+\d{4}-\d{2}-\d{2}/g;
	while ((match = snoozeIndividualRe.exec(text)) !== null) {
		dateTokens.push({
			token: match[0],
			priority: priorities['💤']
		});
	}

	// 2. Snooze all subtasks with individual date: 💤⬇️<span style="display: none">username</span> YYYY-MM-DD
	const snoozeAllIndividualRe = /💤⬇️<span style="display: none">([^<]+)<\/span>\s+\d{4}-\d{2}-\d{2}/g;
	while ((match = snoozeAllIndividualRe.exec(text)) !== null) {
		dateTokens.push({
			token: match[0],
			priority: priorities['💤⬇️']
		});
	}

	// 3. Snooze with folder (multiple dates): 💤🗂️<span style="display: none">[{...}]</span>
	const snoozeFolderRe = /💤🗂️<span style="display: none">\[[\s\S]*?\]<\/span>/g;
	while ((match = snoozeFolderRe.exec(text)) !== null) {
		dateTokens.push({
			token: match[0],
			priority: priorities['💤']
		});
	}

	// 4. Snooze all subtasks with folder: 💤⬇️🗂️<span style="display: none">[{...}]</span>
	const snoozeAllFolderRe = /💤⬇️🗂️<span style="display: none">\[[\s\S]*?\]<\/span>/g;
	while ((match = snoozeAllFolderRe.exec(text)) !== null) {
		dateTokens.push({
			token: match[0],
			priority: priorities['💤⬇️']
		});
	}

	// 5. Global snooze (no date): 💤 (standalone)
	const globalSnoozeRe = /💤(?!\S)/g;
	while ((match = globalSnoozeRe.exec(text)) !== null) {
		// Make sure it's not part of another snooze pattern
		const fullMatch = match[0];
		const index = match.index;
		const after = text.slice(index + fullMatch.length, index + fullMatch.length + 10);
		if (!after.match(/^(?:<span|⬇️|🗂️)/)) {
			dateTokens.push({
				token: fullMatch,
				priority: priorities['💤']
			});
		}
	}

	// 6. Global snooze all subtasks: 💤⬇️ (standalone)
	const globalSnoozeAllRe = /💤⬇️(?!\S)/g;
	while ((match = globalSnoozeAllRe.exec(text)) !== null) {
		const fullMatch = match[0];
		const index = match.index;
		const after = text.slice(index + fullMatch.length, index + fullMatch.length + 10);
		if (!after.match(/^(?:<span|🗂️)/)) {
			dateTokens.push({
				token: fullMatch,
				priority: priorities['💤⬇️']
			});
		}
	}

	// Sort by priority and return tokens
	dateTokens.sort((a, b) => a.priority - b.priority);
	return dateTokens.map(dt => dt.token);
}

/**
 * Remove all date tokens from text
 */
function removeDateTokensFromText(text: string): string {
	// Remove standard date tokens
	text = text.replace(/(🛫|⏳|📅|🎯|✅|❌)\s+\d{4}-\d{2}-\d{2}/g, " ");
	
	// Remove snooze tokens
	text = text.replace(/💤<span style="display: none">([^<]+)<\/span>\s+\d{4}-\d{2}-\d{2}/g, " ");
	text = text.replace(/💤⬇️<span style="display: none">([^<]+)<\/span>\s+\d{4}-\d{2}-\d{2}/g, " ");
	text = text.replace(/💤🗂️<span style="display: none">\[[\s\S]*?\]<\/span>/g, " ");
	text = text.replace(/💤⬇️🗂️<span style="display: none">\[[\s\S]*?\]<\/span>/g, " ");
	text = text.replace(/💤(?!\S)/g, " ");
	text = text.replace(/💤⬇️(?!(?:\S|🗂️))/g, " ");
	
	return text;
}
