/**
 * "Format all task lines in this note": reorders chips on every task line of the
 * active editor through the service's `normalizeWholeFile` path, applying only the
 * lines that changed in a single editor transaction (one undo step; cursor, folds and
 * untouched lines are left alone).
 */

import { createCanonicalFormatterService } from "./canonical-formatter-service";

type Pos = { line: number; ch: number };

/** The slice of Obsidian's Editor this needs. */
export type NoteEditorLike = {
	lineCount(): number;
	getLine(line: number): string;
	transaction(tx: {
		changes: Array<{ from: Pos; to: Pos; text: string }>;
	}): void;
};

/** Returns how many lines were rewritten. */
export async function formatNoteTaskLines(
	editor: NoteEditorLike
): Promise<number> {
	let rewritten = 0;
	const snapshot = readLines(editor);

	const svc = createCanonicalFormatterService({
		getCurrentLine: () => null,
		getAllLines: () => snapshot,
		replaceAllLines: (newLines: string[]) => {
			const changes: Array<{ from: Pos; to: Pos; text: string }> = [];
			const count = Math.min(newLines.length, editor.lineCount());
			for (let i = 0; i < count; i++) {
				const old = editor.getLine(i);
				if (newLines[i] === old) continue;
				// The note may have been edited while the (cooperative) pass ran:
				// never overwrite a line that no longer matches what was formatted.
				if (old !== snapshot[i]) continue;
				changes.push({
					from: { line: i, ch: 0 },
					to: { line: i, ch: old.length },
					text: newLines[i],
				});
			}
			if (changes.length === 0) return;
			editor.transaction({ changes });
			rewritten = changes.length;
		},
	});

	await svc.normalizeWholeFile(snapshot);
	return rewritten;
}

function readLines(editor: NoteEditorLike): string[] {
	const lines: string[] = [];
	for (let i = 0; i < editor.lineCount(); i++) lines.push(editor.getLine(i));
	return lines;
}
