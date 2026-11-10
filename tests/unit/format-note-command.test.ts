import { describe, expect, it } from "vitest";
import { registerFormatNoteCommand } from "../../src/composition/register-commands";
import type { Container } from "../../src/composition/container";

const epic = `<span data-template-wrapper="t1" data-template-key="agile.epic" data-order-tag="artifact-item-type"><mark>Epic</mark></span>`;

type Cmd = {
	id: string;
	name: string;
	hotkeys?: unknown;
	editorCheckCallback?: (checking: boolean, editor: unknown, ctx: unknown) => boolean | void;
	checkCallback?: unknown;
	callback?: unknown;
	editorCallback?: unknown;
};

function setup(master: boolean) {
	const commands: Cmd[] = [];
	const settings = { enableTaskCanonicalFormatter: master };
	const container = {
		plugin: { addCommand: (c: Cmd) => commands.push(c) },
		settings,
	} as unknown as Container;
	registerFormatNoteCommand(container);
	return { commands, settings };
}

function fakeEditor(lines: string[]) {
	const txs: unknown[] = [];
	return {
		lines,
		txs,
		lineCount: () => lines.length,
		getLine: (n: number) => lines[n],
		transaction: (tx: { changes: Array<{ from: { line: number }; text: string }> }) => {
			txs.push(tx);
			for (const c of tx.changes) lines[c.from.line] = c.text;
		},
	};
}

describe("command: Format all task lines in this note", () => {
	it("is registered once through addCommand with an editorCheckCallback and no default hotkeys", () => {
		const { commands } = setup(true);
		expect(commands).toHaveLength(1);
		const c = commands[0];
		expect(c.name).toBe("Format all task lines in this note");
		expect(typeof c.editorCheckCallback).toBe("function");
		expect(c.hotkeys).toBeUndefined();
		// Not also a plain callback: that would show the command regardless of the toggle.
		expect(c.callback).toBeUndefined();
		expect(c.editorCallback).toBeUndefined();
		expect(c.checkCallback).toBeUndefined();
	});

	it("is available only while the master toggle is on (checked live)", () => {
		const { commands, settings } = setup(true);
		const check = commands[0].editorCheckCallback!;
		const ed = fakeEditor([`- [ ] t ${epic}`]);

		expect(check(true, ed, {})).toBe(true);
		settings.enableTaskCanonicalFormatter = false;
		expect(check(true, ed, {})).toBe(false);
		// Running it with the master off does nothing at all.
		expect(check(false, ed, {})).toBe(false);
		expect(ed.txs).toHaveLength(0);
		settings.enableTaskCanonicalFormatter = true;
		expect(check(true, ed, {})).toBe(true);
	});

	it("checking never edits; running formats the active editor's task lines only", async () => {
		const { commands } = setup(true);
		const check = commands[0].editorCheckCallback!;
		const lines = ["# h", `- [ ] t ${epic}`, "prose"];
		const ed = fakeEditor(lines);

		check(true, ed, {});
		expect(ed.txs).toHaveLength(0);

		expect(check(false, ed, {})).toBe(true);
		await new Promise((r) => setTimeout(r, 0));
		expect(ed.lines).toEqual(["# h", `- [ ] ${epic} t `, "prose"]);
		expect(ed.txs).toHaveLength(1);
	});
});
