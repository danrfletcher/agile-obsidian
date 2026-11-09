import { describe, expect, it } from "vitest";
import {
	createVaultReorderRunner,
	planVaultReorder,
	type VaultReorderHost,
} from "@features/task-canonical-formatter";

const epic = `<span data-template-wrapper="t1" data-template-key="agile.epic" data-order-tag="artifact-item-type"><mark>Epic</mark></span>`;
const custom = `<span data-template-key="custom.x" data-order-tag="artifact-item-type"><mark>Custom</mark></span>`;
const meta = `<span data-template-wrapper="t2" data-template-key="workflows.metadata.pr" data-order-tag="metadata"><mark>PR</mark></span>`;

const unordered = (n: string) => `- [ ] ${n} ${epic}`;
const ordered = (n: string) => `- [ ] ${epic} ${n} `;

/** In-memory vault: a {path: content} map plus a host that records every read/write. */
function memVault(
	initial: Record<string, string>,
	opts: {
		confirm?: (n: number, vault: Record<string, string>) => boolean | Promise<boolean>;
		failOn?: string[];
	} = {}
) {
	const vault: Record<string, string> = { ...initial };
	const log = {
		listed: 0,
		reads: [] as string[],
		writes: [] as string[],
		confirms: [] as number[],
		notices: [] as string[],
	};
	const host: VaultReorderHost<{ path: string }> = {
		listFiles: () => {
			log.listed++;
			return Object.keys(vault).map((path) => ({ path }));
		},
		pathOf: (f) => f.path,
		read: async (f) => {
			log.reads.push(f.path);
			return vault[f.path];
		},
		process: async (f, fn) => {
			if (opts.failOn?.includes(f.path)) throw new Error("disk full");
			// Like vault.process: hand the callback the text as it is *now*.
			const next = fn(vault[f.path]);
			if (next !== vault[f.path]) {
				vault[f.path] = next;
				log.writes.push(f.path);
			}
		},
		confirm: async (n) => {
			log.confirms.push(n);
			return opts.confirm ? opts.confirm(n, vault) : true;
		},
		notify: (m) => {
			log.notices.push(m);
		},
	};
	return { vault, host, log };
}

describe("planVaultReorder", () => {
	it("lists exactly the notes whose content would change", () => {
		const plan = planVaultReorder([
			{ path: "a.md", content: `${unordered("one")}\n` },
			{ path: "b.md", content: `# nothing here\n${ordered("two")}\n` },
			{ path: "c.md", content: "just text\n" },
			{ path: "d.md", content: `x\n${unordered("three")}\n${unordered("four")}\n` },
		]);
		expect(plan.map((p) => [p.path, p.changedLines])).toEqual([
			["a.md", 1],
			["d.md", 2],
		]);
		for (const p of plan) expect(p.after).not.toBe(p.before);
	});

	it("is idempotent: planning the output again gives nothing", () => {
		const files = [
			{ path: "a.md", content: `${unordered("one")}\n` },
			{ path: "b.md", content: `- [ ] t ${custom} ${epic} ${meta}\n` },
		];
		const again = planVaultReorder(
			planVaultReorder(files).map((p) => ({ path: p.path, content: p.after }))
		);
		expect(again).toEqual([]);
	});

	it("keeps CRLF, mixed EOLs and the terminal newline (or lack of one) byte-for-byte", () => {
		const crlf = `# t\r\n${unordered("a")}\r\nplain\r\n`;
		const noFinal = `${unordered("b")}`;
		const mixed = `${unordered("c")}\r\nmid\n${unordered("d")}\n`;
		const plan = planVaultReorder([
			{ path: "crlf.md", content: crlf },
			{ path: "nofinal.md", content: noFinal },
			{ path: "mixed.md", content: mixed },
		]);
		const by = Object.fromEntries(plan.map((p) => [p.path, p.after]));
		expect(by["crlf.md"]).toBe(`# t\r\n${ordered("a")}\r\nplain\r\n`);
		expect(by["nofinal.md"]).toBe(ordered("b"));
		expect(by["nofinal.md"].endsWith("\n")).toBe(false);
		expect(by["mixed.md"]).toBe(`${ordered("c")}\r\nmid\n${ordered("d")}\n`);
	});

	it("changes task lines only: prose, headings and fenced code stay identical", () => {
		const content = [
			"# Heading",
			`prose ${epic} with a chip`,
			"```",
			unordered("in code"),
			"```",
			unordered("real task"),
		].join("\n");
		const [p] = planVaultReorder([{ path: "n.md", content }]);
		expect(p.after.split("\n")).toEqual([
			"# Heading",
			`prose ${epic} with a chip`,
			"```",
			unordered("in code"),
			"```",
			ordered("real task"),
		]);
	});
});

describe("vault-wide run: dry run, confirm, write", () => {
	const seed = () => ({
		"a.md": `${unordered("one")}\n`,
		"b.md": `${ordered("two")}\n`,
		"c.md": `${unordered("three")}\r\n${unordered("four")}\r\n`,
		"d.md": "plain\n",
		"e.md": unordered("no final newline"),
	});

	it("the dialog gets N, and confirm writes exactly those N files", async () => {
		const { vault, host, log } = memVault(seed());
		const before = { ...vault };
		const res = await createVaultReorderRunner(host)();

		expect(log.confirms).toEqual([3]);
		expect(res).toMatchObject({ status: "done", changed: 3, written: 3, failed: 0, lines: 4 });
		expect(log.writes.sort()).toEqual(["a.md", "c.md", "e.md"]);
		expect(vault["b.md"]).toBe(before["b.md"]);
		expect(vault["d.md"]).toBe(before["d.md"]);
		expect(vault["c.md"]).toBe(`${ordered("three")}\r\n${ordered("four")}\r\n`);
		expect(vault["e.md"]).toBe(ordered("no final newline"));
		expect(vault["e.md"].endsWith("\n")).toBe(false);
	});

	it("dry-run count equals the number of files written", async () => {
		const { host, log } = memVault(seed());
		const res = await createVaultReorderRunner(host)();
		expect(res.status).toBe("done");
		expect(log.confirms[0]).toBe(log.writes.length);
	});

	it("shows no 'Started formatting' notice before confirmation", async () => {
		const { host, log } = memVault(seed(), {
			confirm: () => {
				expect(log.notices).toEqual([]);
				return true;
			},
		});
		await createVaultReorderRunner(host)();
		expect(log.notices[0]).toBe("Started formatting all files…");
	});

	it("cancel (or Esc / close) writes nothing and shows no Started notice", async () => {
		const { vault, host, log } = memVault(seed(), { confirm: () => false });
		const before = { ...vault };
		const res = await createVaultReorderRunner(host)();
		expect(res).toMatchObject({ status: "cancelled", changed: 3 });
		expect(log.writes).toEqual([]);
		expect(vault).toEqual(before);
		expect(log.notices).toEqual([]);
	});

	it("N = 0: says nothing needs reordering, opens no dialog, writes nothing", async () => {
		const { vault, host, log } = memVault({ "a.md": `${ordered("x")}\n`, "b.md": "hi\n" });
		const before = { ...vault };
		const res = await createVaultReorderRunner(host)();
		expect(res).toEqual({ status: "none", scanned: 2 });
		expect(log.confirms).toEqual([]);
		expect(log.writes).toEqual([]);
		expect(vault).toEqual(before);
		expect(log.notices).toHaveLength(1);
		expect(log.notices[0]).toMatch(/nothing to reorder/i);
	});

	it("a second dry run after confirming reports 0", async () => {
		const { host, log } = memVault(seed());
		const run = createVaultReorderRunner(host);
		await run();
		const second = await run();
		expect(second.status).toBe("none");
		expect(log.confirms).toEqual([3]);
	});

	it("a note edited between the dry run and confirm is recomputed, never overwritten with stale text", async () => {
		const { vault, host, log } = memVault(seed(), {
			confirm: (_n, v) => {
				// The user keeps typing in a.md while the dialog is open.
				v["a.md"] = `${unordered("one")}\n- [ ] brand new line typed meanwhile\n`;
				// ...and c.md was fixed by hand, so it no longer needs reordering.
				v["c.md"] = `${ordered("three")}\r\n`;
				return true;
			},
		});
		const res = await createVaultReorderRunner(host)();
		expect(vault["a.md"]).toBe(
			`${ordered("one")}\n- [ ] brand new line typed meanwhile\n`
		);
		expect(vault["c.md"]).toBe(`${ordered("three")}\r\n`);
		expect(log.writes.sort()).toEqual(["a.md", "e.md"]);
		expect(res).toMatchObject({ status: "done", changed: 3, written: 2 });
	});

	it("touches no file other than the planned ones", async () => {
		const { host, log } = memVault(seed());
		await createVaultReorderRunner(host)();
		const writable = new Set(["a.md", "c.md", "e.md"]);
		expect(log.writes.every((p) => writable.has(p))).toBe(true);
	});

	it("rapid double click: one dialog, one pass", async () => {
		let release!: (v: boolean) => void;
		const gate = new Promise<boolean>((r) => (release = r));
		const { host, log } = memVault(seed(), { confirm: () => gate });
		const run = createVaultReorderRunner(host);

		const first = run();
		const second = run();
		const third = run();
		expect(await second).toEqual({ status: "busy" });
		expect(await third).toEqual({ status: "busy" });
		// Let the first one reach the dialog, then confirm it.
		await new Promise((r) => setTimeout(r, 0));
		release(true);
		const res = await first;

		expect(res.status).toBe("done");
		expect(log.confirms).toHaveLength(1);
		expect(log.listed).toBe(1);
		expect(log.writes.sort()).toEqual(["a.md", "c.md", "e.md"]);
		// And the button works again afterwards.
		expect((await run()).status).toBe("none");
	});

	it("a failed write is counted and does not stop the other files", async () => {
		const { vault, host } = memVault(seed(), { failOn: ["a.md"] });
		const res = await createVaultReorderRunner(host)();
		expect(res).toMatchObject({ status: "done", changed: 3, written: 2, failed: 1 });
		expect(vault["a.md"]).toBe(`${unordered("one")}\n`);
		expect(vault["c.md"]).toBe(`${ordered("three")}\r\n${ordered("four")}\r\n`);
	});

	it("reads files only when run() is called, never on construction", () => {
		const { host, log } = memVault(seed());
		createVaultReorderRunner(host);
		expect(log.listed).toBe(0);
		expect(log.reads).toEqual([]);
	});
});
