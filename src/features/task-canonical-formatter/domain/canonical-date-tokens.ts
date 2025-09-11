// Reuse your existing logic, packaged as pure helpers
export function extractAndOrderDateTokens(text: string): string[] {
	const dateTokens: Array<{ token: string; priority: number }> = [];
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

	const standardDateRe = /(🛫|⏳|📅|🎯|✅|❌)\s+\d{4}-\d{2}-\d{2}/g;
	let match: RegExpExecArray | null;
	while ((match = standardDateRe.exec(text)) !== null) {
		const emoji = match[1];
		dateTokens.push({
			token: match[0],
			priority: priorities[emoji] ?? 999,
		});
	}

	const snoozeIndividualRe =
		/💤<span style="display: none">([^<]+)<\/span>\s+\d{4}-\d{2}-\d{2}/g;
	while ((match = snoozeIndividualRe.exec(text)) !== null) {
		dateTokens.push({ token: match[0], priority: priorities["💤"] });
	}

	const snoozeAllIndividualRe =
		/💤⬇️<span style="display: none">([^<]+)<\/span>\s+\d{4}-\d{2}-\d{2}/g;
	while ((match = snoozeAllIndividualRe.exec(text)) !== null) {
		dateTokens.push({ token: match[0], priority: priorities["💤⬇️"] });
	}

	const snoozeFolderRe =
		/💤🗂️<span style="display: none">\[[\s\S]*?\]<\/span>/g;
	while ((match = snoozeFolderRe.exec(text)) !== null) {
		dateTokens.push({ token: match[0], priority: priorities["💤"] });
	}

	const snoozeAllFolderRe =
		/💤⬇️🗂️<span style="display: none">\[[\s\S]*?\]<\/span>/g;
	while ((match = snoozeAllFolderRe.exec(text)) !== null) {
		dateTokens.push({ token: match[0], priority: priorities["💤⬇️"] });
	}

	const globalSnoozeRe = /💤(?!\S)/g;
	while ((match = globalSnoozeRe.exec(text)) !== null) {
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

	const globalSnoozeAllRe = /💤⬇️(?!\S)/g;
	while ((match = globalSnoozeAllRe.exec(text)) !== null) {
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
	text = text.replace(/(🛫|⏳|📅|🎯|✅|❌)\s+\d{4}-\d{2}-\d{2}/g, " ");
	text = text.replace(
		/💤<span style="display: none">([^<]+)<\/span>\s+\d{4}-\d{2}-\d{2}/g,
		" "
	);
	text = text.replace(
		/💤⬇️<span style="display: none">([^<]+)<\/span>\s+\d{4}-\d{2}-\d{2}/g,
		" "
	);
	text = text.replace(
		/💤🗂️<span style="display: none">\[[\s\S]*?\]<\/span>/g,
		" "
	);
	text = text.replace(
		/💤⬇️🗂️<span style="display: none">\[[\s\S]*?\]<\/span>/g,
		" "
	);
	text = text.replace(/💤(?!\S)/g, " ");
	text = text.replace(/💤⬇️(?!(?:\S|🗂️))/g, " ");
	return text;
}
