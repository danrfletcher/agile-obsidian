import { escapeRegExp } from "@utils";

export const COMPLETED_EMOJI = "✅";
export const CANCELLED_EMOJI = "❌";

// YYYY-MM-DD or ISO-like (date + optional time + tz)
export const ISO_DATE_RE =
	/\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?(?:Z|[+-]\d{2}:\d{2})?/;

export function setCheckboxStatusChar(
	line: string,
	newChar: "x" | "-"
): string {
	// Normalize the checkbox token to `[x]` or `[-]` (no interior spaces)
	return line.replace(
		/^(\s*(?:[-*+]|\d+[.)])\s*\[)\s*[^\]]?\s*(\])/,
		(_m, p1: string, p2: string) => `${p1}${newChar}${p2}`
	);
}

export function hasEmoji(line: string, emoji: string): boolean {
	const re = new RegExp(
		`${escapeRegExp(emoji)}(?:\\s?${ISO_DATE_RE.source})?`
	);
	return re.test(line);
}

export function removeEmoji(line: string, emoji: string): string {
	const re = new RegExp(
		`\\s*${escapeRegExp(emoji)}(?:\\s?${ISO_DATE_RE.source})?`,
		"g"
	);
	return line.replace(re, "").replace(/\s+$/, "");
}

export function appendEmojiWithDate(
    line: string,
    emoji: string,
    dateStr?: string | null
): string {
    const trimmed = line.replace(/\s+$/, "");
    const suffix = dateStr ? `${emoji} ${dateStr}` : `${emoji}`;
    return `${trimmed} ${suffix}`;
}
