import { describe, expect, it } from "vitest";
import { normalizeTaskLine } from "@features/task-canonical-formatter";
import {
	findAllWrappers,
	removeWrappersByTemplate,
} from "@features/task-canonical-formatter/domain/html/canonical-html-scanner";
import fixture from "../fixtures/preset-render.json";

/**
 * F5: the formatter only reorders tokens. For every line, the multiset of chip wrapper
 * HTML strings (and of plain tokens) in the output equals the input's.
 */

const wrappersOf = (line: string) => findAllWrappers(line).sort();

/** Plain tokens outside chips, ignoring the "→" joiner the formatter may write. */
const plainTokensOf = (line: string) =>
	removeWrappersByTemplate(line)
		.withoutWrappers.split(/\s+/)
		.filter((t) => t && t !== "→" && t !== "-" && t !== "[" && t !== "]")
		.sort();

const handWritten = [
	`<span data-template-wrapper="h1" data-template-key="custom.x" data-order-tag="artifact-item-type"><mark>Custom X</mark></span>`,
	`<span data-template-wrapper="h2" data-template-key="custom.y" data-order-tag="artifact-item-type"><mark  style="x">Custom   Y</mark></span>`,
	`<span data-template-wrapper="h3" data-template-key="agile.parentLink" data-order-tag="parent-link"><a href="A.md">⬆️</a></span>`,
	`<span data-template-wrapper="h4" data-template-key="agile.parentLink" data-order-tag="parent-link"><a href="B.md">⬆️</a></span>`,
	`<span data-template-wrapper="h5" data-template-key="custom.s" data-order-tag="state"><mark>S</mark></span>`,
	`<span data-template-wrapper="h6" data-template-key="custom.m" data-order-tag="metadata"><mark>M</mark></span>`,
	`<span data-template-wrapper="h7" data-template-key="custom.u" data-order-tag="zzz-unknown"><mark>U</mark></span>`,
	`<span data-template-wrapper="h8" data-template-key="custom.n"><mark>No tag</mark></span>`,
	`<span data-template-wrapper="h9" data-template-key="members.assignee" data-order-tag="assignment" data-assign-type="assignee"><mark  style="b">Ann</mark></span>`,
	`<span data-template-wrapper="h10" data-template-key="members.assignee" data-order-tag="assignment" data-assign-type="delegate"><mark  style="b">Bob</mark></span>`,
	`<span data-template-wrapper="h11" data-template-key="members.assignee" data-order-tag="assignment" data-assign-type="special"><mark>Sp</mark></span>`,
];

const rendered = fixture.cases.map((c) => c.html);
const pool = [...rendered, ...handWritten];

const textBits = ["Fix", "the login", "flow", "a < b", "x  y", "uses → arrow"];
const extraBits = [
	"📅 2025-01-01",
	"🛫 2025-01-01",
	"⏳ 2025-03-03",
	"✅ 2025-02-02",
	"❌ 2025-04-04",
	"🎯 2025-05-05",
	"💤",
	"💤⬇️",
];

// Small deterministic PRNG so failures reproduce.
function prng(seed: number) {
	let s = seed;
	return () => {
		s = (s * 1664525 + 1013904223) & 0x7fffffff;
		return s / 0x7fffffff;
	};
}

function generateLines(count: number, seed: number): string[] {
	const rnd = prng(seed);
	const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];
	const lines: string[] = [];
	for (let n = 0; n < count; n++) {
		const parts: string[] = [];
		const chips = 1 + Math.floor(rnd() * 6); // up to 6 chips, mixed tags
		for (let i = 0; i < chips; i++) parts.push(pick(pool));
		if (rnd() < 0.8) parts.splice(Math.floor(rnd() * (parts.length + 1)), 0, pick(textBits));
		if (rnd() < 0.5) parts.splice(Math.floor(rnd() * (parts.length + 1)), 0, pick(extraBits));
		if (rnd() < 0.3) parts.splice(Math.floor(rnd() * (parts.length + 1)), 0, pick(extraBits));
		if (rnd() < 0.3) parts.splice(Math.floor(rnd() * (parts.length + 1)), 0, "^blk-" + Math.floor(rnd() * 99));
		const bullet = pick(["- [ ] ", "- [x] ", "* [ ] ", "  - [ ] "]);
		lines.push(bullet.startsWith(" ") ? bullet.trimStart() + parts.join(rnd() < 0.5 ? " " : "  ") : bullet + parts.join(rnd() < 0.5 ? " " : "  "));
	}
	return lines;
}

describe("F5: formatter only reorders (property)", () => {
	it("every preset render, alone on a line, comes out with the same wrapper and tokens", () => {
		for (const c of fixture.cases) {
			const line = `- [ ] Some text ${c.html} 📅 2025-01-01 ^id1`;
			const out = normalizeTaskLine(line);
			expect(wrappersOf(out), `${c.id}/${c.case}`).toEqual(wrappersOf(line));
			expect(plainTokensOf(out), `${c.id}/${c.case}`).toEqual(plainTokensOf(line));
		}
	});

	it("generated lines of up to 6 mixed-tag chips keep every chip and token", () => {
		const lines = generateLines(3000, 20261109);
		let changed = 0;
		for (const line of lines) {
			const out = normalizeTaskLine(line);
			expect(wrappersOf(out), line).toEqual(wrappersOf(line));
			expect(plainTokensOf(out), line).toEqual(plainTokensOf(line));
			if (out !== line) changed++;
		}
		// Guard against a vacuous pass (e.g. everything returned unchanged).
		expect(changed).toBeGreaterThan(lines.length * 0.8);
	});

	it("is idempotent on generated lines: f(f(x)) === f(x)", () => {
		for (const line of generateLines(3000, 77)) {
			const once = normalizeTaskLine(line);
			expect(normalizeTaskLine(once), line).toBe(once);
		}
	});

	it("every permutation of a six-chip line keeps all six chips and gives one canonical result", () => {
		const six = [
			handWritten[0], // custom artifact type
			rendered.find((h) => h.includes('data-template-key="agile.epic"'))!,
			handWritten[2], // parent link
			handWritten[4], // state
			handWritten[6], // unknown tag
			handWritten[5], // metadata
		];
		const permutations = (a: string[]): string[][] =>
			a.length <= 1
				? [a]
				: a.flatMap((x, i) =>
						permutations([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p])
				  );
		const outs = new Set<string>();
		for (const perm of permutations(six)) {
			const line = `- [ ] ${perm.slice(0, 3).join(" ")} text ${perm.slice(3).join(" ")}`;
			const out = normalizeTaskLine(line);
			expect(wrappersOf(out)).toEqual(wrappersOf(line));
			expect(normalizeTaskLine(out)).toBe(out);
			// Group order is fixed; only the order inside a tag may differ with the input.
			outs.add(out.replace(/\s+/g, " "));
		}
		// custom + epic are both artifact-item-type, so 2 orderings (who was first) remain.
		expect(outs.size).toBe(2);
	});
});

describe("F5: unbalanced chips leave the line untouched", () => {
	it("never changes a line whose wrapper is not closed", () => {
		for (const chip of handWritten.slice(0, 6)) {
			const broken = chip.replace(/<\/span>$/, "");
			const line = `- [ ] b ${handWritten[6]} ${broken} text that must survive ^x`;
			expect(normalizeTaskLine(line)).toBe(line);
		}
	});
});
