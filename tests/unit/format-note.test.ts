import { describe, expect, it } from "vitest";
import {
	formatNoteTaskLines,
	type NoteEditorLike,
} from "@features/task-canonical-formatter";

const epic = `<span data-template-wrapper="t1" data-template-key="agile.epic" data-order-tag="artifact-item-type"><mark>Epic</mark></span>`;
const custom = `<span data-template-key="custom.x" data-order-tag="artifact-item-type"><mark>Custom</mark></span>`;

function fakeEditor(initial: string[]) {
	const lines = [...initial];
	const txs: Array<Array<{ line: number; text: string }>> = [];
	const editor: NoteEditorLike = {
		lineCount: () => lines.length,
		getLine: (n) => lines[n],
		transaction: ({ changes }) => {
			txs.push(changes.map((c) => ({ line: c.from.line, text: c.text })));
			for (const c of changes) {
				expect(c.from.line).toBe(c.to.line);
				expect(c.from.ch).toBe(0);
				expect(c.to.ch).toBe(lines[c.from.line].length);
				lines[c.from.line] = c.text;
			}
		},
	};
	return { editor, lines, txs };
}

describe("formatNoteTaskLines (Format all task lines in this note)", () => {
	it("rewrites only the task lines that change, in one transaction", async () => {
		const seed = [
			"# Demo",
			`- [ ] text ${custom} ${epic}`,
			"plain paragraph",
			"```",
			`- [ ] in fence ${epic}`,
			"```",
			`- [ ] ${epic} already ordered `,
		];
		const { editor, lines, txs } = fakeEditor(seed);
		const n = await formatNoteTaskLines(editor);

		expect(n).toBe(1);
		expect(txs).toHaveLength(1);
		expect(lines[1]).toBe(`- [ ] ${custom} ${epic} text `);
		// Everything else byte-identical, including both chips on the changed line.
		expect([0, 2, 3, 4, 5, 6].map((i) => lines[i])).toEqual(
			[0, 2, 3, 4, 5, 6].map((i) => seed[i])
		);
	});

	it("makes no transaction when the note is already in order", async () => {
		const { editor, txs } = fakeEditor(["# x", `- [ ] ${epic} t `]);
		expect(await formatNoteTaskLines(editor)).toBe(0);
		expect(txs).toHaveLength(0);
	});

	it("does not overwrite a line edited while the pass was running", async () => {
		const base = Array.from({ length: 120 }, () => `- [ ] text ${epic}`);
		const { editor, lines } = fakeEditor(base);
		const run = formatNoteTaskLines(editor);
		// The pass yields every 50 lines; the user edits line 3 meanwhile.
		lines[3] = "- [ ] user typed this";
		await run;
		expect(lines[3]).toBe("- [ ] user typed this");
		expect(lines[4]).toBe(`- [ ] ${epic} text `);
	});
});
