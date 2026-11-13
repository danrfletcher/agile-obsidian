/**
 * Pure rules behind the "Custom templates" settings section (no Obsidian, no DOM).
 *
 * `settings.customTemplates` is one raw JSON text per card, in card order. This module
 * holds the rules the view and its controller share, so they can be unit tested:
 * - the starter text for "Add template" and which `custom.template-N` number it gets (I6),
 * - Delete as an array operation,
 * - how a validation result is turned into the status lines shown under a box.
 *
 * Nothing here evaluates card text. The only thing that reads it is `JSON.parse`, or a
 * plain regex when the text does not parse.
 */

/** The starter definition for card number `n`, exactly as it is saved. */
export function buildStarterText(n: number): string {
	return `{"id":"custom.template-${n}","label":"New template","emoji":"⭐","fields":[{"name":"title","required":true}],"text":"{{title}}"}`;
}

// `custom.template-N` where N is a positive integer with no leading zero, and the match
// does not run on into more id characters (so "custom.template-2x" is not number 2).
const NUMBER_IN_TEXT_RE = /custom\.template-([1-9][0-9]*)(?![A-Za-z0-9._-])/g;
const NUMBER_IN_ID_RE = /^custom\.template-([1-9][0-9]*)$/;

// Numbers this large are not worth tracking; the search for a free number never reaches them.
const MAX_TRACKED = 1_000_000_000;

function addNumber(used: Set<number>, digits: string): void {
	const n = Number(digits);
	if (Number.isSafeInteger(n) && n <= MAX_TRACKED) used.add(n);
}

/**
 * The N of every `custom.template-N` already used by a card, valid or not.
 * - Text that parses as an object with a string `id`: that id decides (a mention of
 *   another id inside `label` or `text` does not count).
 * - Text that does not parse as JSON (a typo, a missing brace, a half-typed id): every
 *   `custom.template-N` in the raw text counts, so an invalid card still holds its number.
 * - Parsed text with no string id uses no number.
 */
export function usedStarterNumbers(texts: readonly string[]): Set<number> {
	const used = new Set<number>();
	for (const text of texts) {
		if (typeof text !== "string") continue;
		let parsed: unknown;
		let parses = true;
		try {
			parsed = JSON.parse(text);
		} catch {
			parses = false;
		}
		if (parses) {
			if (
				typeof parsed === "object" &&
				parsed !== null &&
				!Array.isArray(parsed) &&
				typeof (parsed as { id?: unknown }).id === "string"
			) {
				const m = NUMBER_IN_ID_RE.exec((parsed as { id: string }).id);
				if (m) addNumber(used, m[1]);
			}
			continue;
		}
		NUMBER_IN_TEXT_RE.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = NUMBER_IN_TEXT_RE.exec(text)) !== null) addNumber(used, m[1]);
	}
	return used;
}

/** The smallest positive integer not used as `custom.template-N` by any card. */
export function nextStarterNumber(texts: readonly string[]): number {
	const used = usedStarterNumbers(texts);
	let n = 1;
	while (used.has(n)) n++;
	return n;
}

/** "Add template": a new array with the starter appended, and the new card's position. */
export function appendStarter(texts: readonly string[]): {
	texts: string[];
	index: number;
} {
	const next = [...texts, buildStarterText(nextStarterNumber(texts))];
	return { texts: next, index: next.length - 1 };
}

/** "Delete": a new array without card `index`. The other cards keep their text and order. */
export function removeCard(texts: readonly string[], index: number): string[] {
	if (!Number.isInteger(index) || index < 0 || index >= texts.length) {
		return [...texts];
	}
	return [...texts.slice(0, index), ...texts.slice(index + 1)];
}

/** The part of the validator's result the status line needs. */
export interface CardValidation {
	ok: boolean;
	/** One display string per error, as the validator produced them (`path: message`). */
	messages: readonly string[];
}

export interface CardStatus {
	valid: boolean;
	/** "Valid", or one line per error. */
	lines: string[];
}

export const VALID_STATUS_LINE = "Valid";

/**
 * What to show under a box: "Valid", or the validator's messages, one line each and
 * unaltered (a JSON syntax error is the parser's own message).
 */
export function formatCardStatus(v: CardValidation): CardStatus {
	if (v.ok) return { valid: true, lines: [VALID_STATUS_LINE] };
	// A failed result always has at least one message; keep a line anyway so the box
	// never shows nothing for an invalid card.
	const lines = v.messages.length > 0 ? [...v.messages] : ["Invalid"];
	return { valid: false, lines };
}
