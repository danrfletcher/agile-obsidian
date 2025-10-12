/**
 * Utilities to extract, order, and remove date/snooze tokens from a task line.
 * Prioritization determines the canonical ordering of tokens when reassembling.
 */

const priorities: Record<string, number> = {
	"🛫": 1,
	"⏳": 2,
	"📅": 3,
	"🎯": 4,
	"💤": 5,
	"💤⬇️": 6,
	"✅": 7,
	"❌": 8,
};

// Precompiled regex constants (hot path)
const STANDARD_DATE_RE = /(🛫|⏳|📅|🎯|✅|❌)\s+\d{4}-\d{2}-\d{2}/g;
const SNOOZE_INDIVIDUAL_RE =
	/💤<span style="display: none">([^<]+)<\/span>\s+\d{4}-\d{2}-\d{2}/g;
const SNOOZE_ALL_INDIVIDUAL_RE =
	/💤⬇️<span style="display: none">([^<]+)<\/span>\s+\d{4}-\d{2}-\d{2}/g;
const SNOOZE_FOLDER_RE =
	/💤🗂️<span style="display: none">\[[\s\S]*?\]<\/span>/g;
const SNOOZE_ALL_FOLDER_RE =
	/💤⬇️🗂️<span style="display: none">\[[\s\S]*?\]<\/span>/g;
const GLOBAL_SNOOZE_RE = /💤(?!\S)/g;
const GLOBAL_SNOOZE_ALL_RE = /💤⬇️(?!\S)/g;

export function extractAndOrderDateTokens(text: string): string[] {
	const dateTokens: Array<{ token: string; priority: number }> = [];
	let match: RegExpExecArray | null;

	while ((match = STANDARD_DATE_RE.exec(text)) !== null) {
		const emoji = match[1];
		dateTokens.push({
			token: match[0],
			priority: priorities[emoji] ?? 999,
		});
	}

	while ((match = SNOOZE_INDIVIDUAL_RE.exec(text)) !== null) {
		dateTokens.push({ token: match[0], priority: priorities["💤"] });
	}

	while ((match = SNOOZE_ALL_INDIVIDUAL_RE.exec(text)) !== null) {
		dateTokens.push({ token: match[0], priority: priorities["💤⬇️"] });
	}

	while ((match = SNOOZE_FOLDER_RE.exec(text)) !== null) {
		dateTokens.push({ token: match[0], priority: priorities["💤"] });
	}

	while ((match = SNOOZE_ALL_FOLDER_RE.exec(text)) !== null) {
		dateTokens.push({ token: match[0], priority: priorities["💤⬇️"] });
	}

	// Global snooze and snooze-all (not followed by span/arrow/folder markers)
	while ((match = GLOBAL_SNOOZE_RE.exec(text)) !== null) {
		const fullMatch = match[0];
		const index = match.index;
		const after = text.slice(
			index + fullMatch.length,
			index + fullMatch.length + 10
		);
		if (!after.match(/^(?:<span|⬇️|🗂️)/)) {
			dateTokens.push({ token: fullMatch, priority: priorities["💤"] });
		}
	}

	while ((match = GLOBAL_SNOOZE_ALL_RE.exec(text)) !== null) {
		const fullMatch = match[0];
		const index = match.index;
		const after = text.slice(
			index + fullMatch.length,
			index + fullMatch.length + 10
		);
		if (!after.match(/^(?:<span|🗂️)/)) {
			dateTokens.push({ token: fullMatch, priority: priorities["💤⬇️"] });
		}
	}

	dateTokens.sort((a, b) => a.priority - b.priority);
	return dateTokens.map((t) => t.token);
}

export function removeDateTokensFromText(text: string): string {
	text = text.replace(STANDARD_DATE_RE, " ");
	text = text.replace(SNOOZE_INDIVIDUAL_RE, " ");
	text = text.replace(SNOOZE_ALL_INDIVIDUAL_RE, " ");
	text = text.replace(SNOOZE_FOLDER_RE, " ");
	text = text.replace(SNOOZE_ALL_FOLDER_RE, " ");
	text = text.replace(GLOBAL_SNOOZE_RE, " ");
	text = text.replace(/💤⬇️(?!(?:\S|🗂️))/g, " ");
	return text;
}
