import { describe, expect, it } from "vitest";
import {
	createCanonicalFormatterService,
	type CanonicalFormatterPort,
} from "@features/task-canonical-formatter";

const epic = `<span data-template-wrapper="t1" data-template-key="agile.epic" data-order-tag="artifact-item-type"><mark>Epic</mark></span>`;
const meta = `<span data-template-wrapper="t2" data-template-key="workflows.metadata.pr" data-order-tag="metadata"><mark>PR</mark></span>`;
const custom = `<span data-template-key="custom.x" data-order-tag="artifact-item-type"><mark>Custom</mark></span>`;

function fakePort(extra: Partial<CanonicalFormatterPort> = {}) {
	const calls: { replaceAllLines: string[][]; replaceLine: Array<[number, string]> } = {
		replaceAllLines: [],
		replaceLine: [],
	};
	const port: CanonicalFormatterPort = {
		getCurrentLine: () => null,
		replaceAllLines: (lines) => {
			calls.replaceAllLines.push(lines);
		},
		...extra,
	};
	return { port, calls };
}

describe("normalizeWholeFile (fake port)", () => {
	it("reorders task lines, leaves everything else byte-identical, keeps indentation", async () => {
		const { port, calls } = fakePort();
		const svc = createCanonicalFormatterService(port);
		const lines = [
			"# Heading",
			"",
			`plain paragraph with ${epic} in it`,
			`- [ ] text ${epic}`,
			`    - [x] nested ${meta} ${epic}`,
			`\t\t- [ ] tab indented ${meta} ${epic}`,
			"- a bullet that is not a task",
			`  ${epic} stray chip line`,
		];
		await svc.normalizeWholeFile(lines);

		expect(calls.replaceAllLines).toHaveLength(1);
		const out = calls.replaceAllLines[0];
		expect(out).toHaveLength(lines.length);
		expect(out[0]).toBe(lines[0]);
		expect(out[1]).toBe(lines[1]);
		expect(out[2]).toBe(lines[2]);
		expect(out[3]).toBe(`- [ ] ${epic} text `);
		expect(out[4]).toBe(`    - [x] ${epic} nested ${meta} `);
		expect(out[5]).toBe(`\t\t- [ ] ${epic} tab indented ${meta} `);
		expect(out[6]).toBe(lines[6]);
		expect(out[7]).toBe(lines[7]);
	});

	it("keeps extra artifact-item-type chips on the line", async () => {
		const { port, calls } = fakePort();
		await createCanonicalFormatterService(port).normalizeWholeFile([
			`- [ ] t ${custom} ${epic}`,
		]);
		expect(calls.replaceAllLines[0][0]).toBe(`- [ ] ${custom} ${epic} t `);
	});

	it("does not touch task-looking lines inside fenced code", async () => {
		const { port, calls } = fakePort();
		const lines = [
			"```md",
			`- [ ] text ${epic}`,
			"```",
			`- [ ] text ${epic}`,
			"~~~~",
			`- [ ] text ${epic}`,
			"~~~~",
			"````",
			"```",
			`- [ ] text ${epic}`,
			"````",
		];
		await createCanonicalFormatterService(port).normalizeWholeFile(lines);
		const out = calls.replaceAllLines[0];
		expect(out[1]).toBe(lines[1]);
		expect(out[3]).toBe(`- [ ] ${epic} text `);
		expect(out[5]).toBe(lines[5]);
		expect(out[9]).toBe(lines[9]);
	});

	it("does not call replaceAllLines when nothing changes", async () => {
		const { port, calls } = fakePort();
		await createCanonicalFormatterService(port).normalizeWholeFile([
			"# title",
			`- [ ] ${epic} text `,
		]);
		expect(calls.replaceAllLines).toHaveLength(0);
	});

	it("abort stops before replaceAllLines", async () => {
		const { port, calls } = fakePort();
		const ctl = new AbortController();
		ctl.abort();
		await createCanonicalFormatterService(port).normalizeWholeFile(
			[`- [ ] text ${epic}`],
			{ abortSignal: ctl.signal }
		);
		expect(calls.replaceAllLines).toHaveLength(0);
	});

	it("abort during the run (after a cooperative yield) stops before replaceAllLines", async () => {
		const { port, calls } = fakePort();
		const ctl = new AbortController();
		const lines = Array.from({ length: 120 }, () => `- [ ] text ${epic}`);
		const run = createCanonicalFormatterService(port).normalizeWholeFile(
			lines,
			{ abortSignal: ctl.signal }
		);
		// The service yields to the event loop every 50 lines; abort while it is parked.
		setTimeout(() => ctl.abort(), 0);
		await run;
		expect(calls.replaceAllLines).toHaveLength(0);
	});

	it("falls back to replaceLine per changed line when the host has no replaceAllLines", async () => {
		const replaced: Array<[number, string]> = [];
		const port: CanonicalFormatterPort = {
			getCurrentLine: () => null,
			replaceLine: (n, l) => {
				replaced.push([n, l]);
			},
		};
		await createCanonicalFormatterService(port).normalizeWholeFile([
			"keep",
			`- [ ] text ${epic}`,
		]);
		expect(replaced).toEqual([[1, `- [ ] ${epic} text `]]);
	});
});
