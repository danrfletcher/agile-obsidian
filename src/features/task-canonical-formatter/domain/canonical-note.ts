/**
 * Whole-note helpers: which lines are inside fenced code, how to format one line while
 * keeping its indentation, and how to reorder a whole note's text without touching
 * anything but task lines (line endings, terminal newline and non-task lines are kept
 * byte-identical).
 */

import { normalizeTaskLine } from "./canonical-normalize";

const FENCE_RE = /^\s*(`{3,}|~{3,})(.*)$/;

/**
 * Marks lines that belong to a fenced code block (opening fence, body and closing
 * fence). Task-looking lines inside a fence are code samples, not tasks, so whole-note
 * formatting leaves them alone. An unclosed fence runs to the end of the note.
 */
export function markFencedLines(lines: readonly string[]): boolean[] {
	const mask = new Array<boolean>(lines.length).fill(false);
	let open: { ch: string; len: number } | null = null;

	for (let i = 0; i < lines.length; i++) {
		const m = FENCE_RE.exec(lines[i]);
		if (!open) {
			if (!m) continue;
			const ch = m[1][0];
			// A backtick fence's info string cannot contain a backtick (inline code).
			if (ch === "`" && m[2].includes("`")) continue;
			open = { ch, len: m[1].length };
			mask[i] = true;
			continue;
		}
		mask[i] = true;
		if (m && m[1][0] === open.ch && m[1].length >= open.len && !m[2].trim()) {
			open = null;
		}
	}
	return mask;
}

/** Formats one line, keeping its leading whitespace exactly as it was. */
export function normalizeLineKeepingIndent(oldLine: string): string {
	const indent = /^\s*/.exec(oldLine)?.[0] ?? "";
	return indent + normalizeTaskLine(oldLine.slice(indent.length));
}

/**
 * Reorders chips on every task line of a note's text. Everything else is returned
 * byte-for-byte: non-task lines, lines inside fenced code, each line's own EOL (LF or
 * CRLF, even mixed) and whether the text ends with a newline.
 */
export function reorderNoteContent(content: string): {
	content: string;
	changedLines: number;
} {
	// Even indexes are lines, odd indexes are the separators between them.
	const parts = content.split(/(\r\n|\n)/);
	const lines: string[] = [];
	for (let i = 0; i < parts.length; i += 2) lines.push(parts[i]);

	const fenced = markFencedLines(lines);
	let changedLines = 0;
	for (let i = 0; i < lines.length; i++) {
		if (fenced[i]) continue;
		const next = normalizeLineKeepingIndent(lines[i]);
		if (next !== lines[i]) {
			parts[i * 2] = next;
			changedLines++;
		}
	}
	return changedLines === 0
		? { content, changedLines: 0 }
		: { content: parts.join(""), changedLines };
}
