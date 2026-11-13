import { describe, expect, it } from "vitest";
import { normalizeTaskLine } from "@features/task-canonical-formatter";

/**
 * Chip builder for hand-written lines. Output is a plain wrapper span exactly like the
 * plugin writes (wrapper > mark > text), so tests exercise the real scanner/extractor.
 */
function chip(key: string, orderTag: string | null, text = "x"): string {
	const tag = orderTag === null ? "" : ` data-order-tag="${orderTag}"`;
	return `<span data-template-wrapper="tpl-1" data-template-key="${key}"${tag}><mark style="background: #CACFD9A6;">${text}</mark></span>`;
}

const epic = chip("agile.epic", "artifact-item-type", "Epic");
const story = chip("agile.userStory", "artifact-item-type", "Story");
const custom = chip("custom.x", "artifact-item-type", "Custom");
const custom2 = chip("custom.y", "artifact-item-type", "Custom2");
const parent1 = chip("agile.parentLink", "parent-link", "P1");
const parent2 = chip("agile.parentLink", "parent-link", "P2");
const blocked = chip("workflows.states.blocked", "state", "Blocked");
const pending = chip("workflows.states.pending", "state", "Pending");
const pay = chip("crm.depositPaid", "crm-payment", "Paid");
const commission = chip("crm.commission", "crm-commission", "Comm");
const prio = chip("prio.kano.dissatisfier", "priority", "Prio");
const noTag = chip("prio.moscow.must", null, "Must");
const meta = chip("workflows.metadata.branch", "metadata", "Branch");
const meta2 = chip("workflows.metadata.pr", "metadata", "PR");

// Old Agile Obsidian assignee / delegate chips, hand-written as that plugin wrote them
// (double space after <mark and all). Order tag "assignment".
const assignee = `<span data-template-wrapper="tpl-a" data-template-key="members.assignee" data-order-tag="assignment" data-assignment-state="active" data-member-slug="ann" data-member-type="teamMember" data-assign-type="assignee"><mark  style="background: #FFB8EBA6; color: #000000;">Ann</mark></span>`;
const delegate = `<span data-template-wrapper="tpl-d" data-template-key="members.assignee" data-order-tag="assignment" data-assignment-state="active" data-member-slug="bob" data-member-type="teamMember" data-assign-type="delegate"><mark  style="background: #FFB8EBA6; color: #000000;">Bob</mark></span>`;
const assignee2 = assignee.replace('data-member-slug="ann"', 'data-member-slug="cy"').replace(">Ann<", ">Cy<");

const f = (line: string) => normalizeTaskLine(line);

describe("canonical order rules (G6)", () => {
	const cases: Array<[string, string, string]> = [
		[
			"first-of-tag then extras: parents then types, original order",
			`- [ ] ${custom2} ${parent2} text ${epic} ${parent1} ${custom}`,
			`- [ ] ${parent2} ${parent1} ${custom2} ${epic} ${custom} text `,
		],
		[
			"two parent-links and two artifact-item-types all stay",
			`- [ ] ${story} ${parent1} text ${epic} ${parent2}`,
			`- [ ] ${parent1} ${parent2} ${story} ${epic} text `,
		],
		[
			"state chips go after the text, in original order",
			`- [ ] ${pending} text ${blocked}`,
			`- [ ] text ${pending} ${blocked} `,
		],
		[
			"other tags: alphabetical by tag, missing tag last, stable among equals",
			`- [ ] text ${noTag} ${prio} ${pay} ${commission} ${chip("a.b", "crm-payment", "Second")}`,
			`- [ ] text ${commission} ${pay} ${chip("a.b", "crm-payment", "Second")} ${prio} ${noTag} `,
		],
		[
			"other tags sit after state and before metadata",
			`- [ ] ${meta} ${prio} ${blocked} text`,
			`- [ ] text ${blocked} ${prio} ${meta} `,
		],
		[
			"metadata chips keep their original order",
			`- [ ] ${meta2} text ${meta}`,
			`- [ ] text ${meta2} ${meta} `,
		],
		[
			"date and snooze tokens keep their priority order, block id last",
			"- [ ] text 💤 ❌ 2025-01-05 ✅ 2025-01-04 🎯 2025-01-03 📅 2025-01-02 ⏳ 2025-01-01 🛫 2025-01-01 ^id-1",
			"- [ ] text 🛫 2025-01-01 ⏳ 2025-01-01 📅 2025-01-02 🎯 2025-01-03 💤 ✅ 2025-01-04 ❌ 2025-01-05 ^id-1",
		],
		[
			"block id in the middle moves to the end",
			`- [ ] text ^mid ${epic}`,
			`- [ ] ${epic} text ^mid`,
		],
		[
			"full line: parent, type, text, state, other, metadata, dates, block id",
			`- [ ] ${meta} ^b1 ${blocked} 📅 2025-02-02 ${prio} text ${epic} ${parent1}`,
			`- [ ] ${parent1} ${epic} text ${blocked} ${prio} ${meta} 📅 2025-02-02 ^b1`,
		],
		[
			"assignee directly followed by its delegate is written assignee → delegate",
			`- [ ] text ${assignee} ${delegate}`,
			`- [ ] text ${assignee} → ${delegate} `,
		],
		[
			"an existing arrow between them is kept as one arrow",
			`- [ ] text ${assignee} → ${delegate}`,
			`- [ ] text ${assignee} → ${delegate} `,
		],
		[
			"delegate with no assignee is kept",
			`- [ ] ${delegate} text`,
			`- [ ] text ${delegate} `,
		],
		[
			"a second assignee is kept in the same group, after the pair",
			`- [ ] text ${assignee} ${delegate} ${assignee2}`,
			`- [ ] text ${assignee} → ${delegate} ${assignee2} `,
		],
		[
			"old assignment chips sort as an unknown tag (before crm-payment, after nothing)",
			`- [ ] text ${pay} ${assignee} ${delegate} ${meta}`,
			`- [ ] text ${assignee} → ${delegate} ${pay} ${meta} `,
		],
		[
			"assignee with no delegate stays a plain chip",
			`- [ ] ${assignee} text`,
			`- [ ] text ${assignee} `,
		],
		[
			"chip with no data-order-tag sorts after tagged others",
			`- [ ] ${noTag} ${assignee} text`,
			`- [ ] text ${assignee} ${noTag} `,
		],
		[
			"indented sub-task is handled by the caller; a bare prefix line is untouched",
			"- [ ] ",
			"- [ ] ",
		],
	];

	it.each(cases)("%s", (_name, input, expected) => {
		expect(f(input)).toBe(expected);
	});

	it("is a no-op on non-task lines", () => {
		for (const line of [
			"",
			"plain paragraph with " + epic,
			"# heading " + epic,
			"- a bullet " + epic,
			"1. numbered " + epic,
		]) {
			expect(f(line)).toBe(line);
		}
	});

	it("keeps a bare '<' in the text from hiding chips after it", () => {
		expect(f(`- [ ] a < b ${epic} more`)).toBe(`- [ ] ${epic} a < b more`);
	});
});

describe("E14: Epic plus a custom artifact-item-type chip", () => {
	const customChip = `<span data-template-key="custom.x" data-order-tag="artifact-item-type"><mark>Custom</mark></span>`;
	const epicChip = chip("agile.epic", "artifact-item-type", "Epic");

	it("keeps both, Epic first because it was first in the input", () => {
		expect(f(`- [ ] text ${epicChip} ${customChip}`)).toBe(
			`- [ ] ${epicChip} ${customChip} text `
		);
	});

	it("keeps both, custom first when it was first", () => {
		expect(f(`- [ ] ${customChip} text ${epicChip}`)).toBe(
			`- [ ] ${customChip} ${epicChip} text `
		);
	});
});

describe("E6: chip whose template no longer exists", () => {
	const gone = `<span data-template-wrapper="tpl-z" data-template-key="custom.deleted" data-order-tag="state"><mark>Gone</mark></span>`;
	const goneNoTag = `<span data-template-wrapper="tpl-y" data-template-key="custom.deleted2"><mark>Gone2</mark></span>`;

	it("is ordered by its data-order-tag and nothing is lost", () => {
		expect(f(`- [ ] ${meta} ${gone} text ${epic}`)).toBe(
			`- [ ] ${epic} text ${gone} ${meta} `
		);
	});

	it("without any order tag it sorts last among the other tags", () => {
		expect(f(`- [ ] ${goneNoTag} ${prio} text`)).toBe(
			`- [ ] text ${prio} ${goneNoTag} `
		);
	});
});

describe("E7: old Agile Obsidian assignee / delegate chips", () => {
	it("reorders only: wrapper HTML, attributes and inner text byte-identical (double spaces included)", () => {
		const out = f(`- [ ] ${assignee} → ${delegate} Write docs ${epic}`);
		expect(out).toBe(`- [ ] ${epic} Write docs ${assignee} → ${delegate} `);
		expect(out).toContain('<mark  style="background: #FFB8EBA6; color: #000000;">Ann</mark>');
		expect(out).toContain('<mark  style="background: #FFB8EBA6; color: #000000;">Bob</mark>');
	});

	it("a delegate on its own is kept, not dropped", () => {
		expect(f(`- [ ] Write docs ${delegate}`)).toBe(`- [ ] Write docs ${delegate} `);
	});
});

describe("chip HTML is never rewritten", () => {
	it("keeps runs of spaces inside a chip (e.g. <mark  style, user values)", () => {
		const spaced = `<span data-template-wrapper="tpl-s" data-template-key="agile.epic" data-order-tag="artifact-item-type"><mark  style="x"><span data-tpl-var="title">two  spaces   here</span></mark></span>`;
		expect(f(`- [ ] text   with   gaps ${spaced}`)).toBe(
			`- [ ] ${spaced} text with gaps `
		);
	});

	it("keeps a ^id, an arrow or a date-looking string that sits inside a chip", () => {
		const odd = `<span data-template-wrapper="tpl-o" data-template-key="custom.q" data-order-tag="metadata"><mark>a → b 📅 2025-01-01</mark></span>`;
		const out = f(`- [ ] text ${odd} ^bid`);
		expect(out.includes(odd)).toBe(true);
	});
});

describe("unbalanced or unclosed wrapper span", () => {
	const unclosed = `<span data-template-wrapper="tpl-u" data-template-key="agile.epic" data-order-tag="artifact-item-type"><mark>Epic</mark>`;

	it("returns the line unchanged when a wrapper is never closed", () => {
		const line = `- [ ] ${blocked} ${unclosed} the task text that must survive 📅 2025-01-01 ^id`;
		expect(f(line)).toBe(line);
	});

	it("returns the line unchanged when the opening tag never ends", () => {
		const line = `- [ ] ${blocked} <span data-template-key="agile.epic" data-order-tag="artifact-item-type" the task text`;
		expect(f(line)).toBe(line);
	});

	it("returns the line unchanged when a tag inside the chip never ends", () => {
		const line = `- [ ] ${meta} <span data-template-key="a.b"><mark style="x" text after`;
		expect(f(line)).toBe(line);
	});
});

describe("idempotence", () => {
	it.each(cases2())("f(f(x)) === f(x): %s", (_n, line) => {
		const once = f(line);
		expect(f(once)).toBe(once);
	});

	function cases2(): Array<[string, string]> {
		return [
			["extras", `- [ ] ${custom} ${epic} ${parent1} ${parent2} text ${meta}`],
			["assignment", `- [ ] ${delegate} ${assignee} ${assignee2} text ${prio}`],
			["dates", "- [ ] text ✅ 2025-01-01 💤 🛫 2025-01-01 ^a"],
			["all", `- [ ] ${meta} ^b ${blocked} 📅 2025-02-02 ${prio} text ${epic} ${parent1}`],
		];
	}
});

describe("goldens: built-in lines come out as the 5a90994 formatter wrote them", () => {
	// Inputs are lines as 5a90994 left them (single space after <mark); expected strings
	// were captured by running the 5a90994 normalizeTaskLine on each input.
	const golden: Array<[string, string, string]> = [
	[
		"artifact-item-type (agile.epic)",
		"- [ ] Fix login <span data-template-wrapper=\"tpl-ID\" data-template-key=\"agile.epic\" data-order-tag=\"artifact-item-type\"><mark style=\"background: #CACFD9A6;\"><strong>🏆 <span data-tpl-var=\"title\">Sample title</span>:</strong></mark> <span data-tpl-var=\"details\">Sample details</span></span> ✅ 2025-01-02 📅 2025-01-01 ^blk-1",
		"- [ ] <span data-template-wrapper=\"tpl-ID\" data-template-key=\"agile.epic\" data-order-tag=\"artifact-item-type\"><mark style=\"background: #CACFD9A6;\"><strong>🏆 <span data-tpl-var=\"title\">Sample title</span>:</strong></mark> <span data-tpl-var=\"details\">Sample details</span></span> Fix login 📅 2025-01-01 ✅ 2025-01-02 ^blk-1",
	],
	[
		"parent-link (agile.parentLink)",
		"- [ ] Fix login <span data-template-wrapper=\"tpl-ID\" data-template-key=\"agile.parentLink\" data-order-tag=\"parent-link\"><a class=\"internal-link\" href=\"Projects/Plan.md#^abc123\" data-tpl-attr-var-href=\"blockRef\">⬆️</a></span> ✅ 2025-01-02 📅 2025-01-01 ^blk-1",
		"- [ ] <span data-template-wrapper=\"tpl-ID\" data-template-key=\"agile.parentLink\" data-order-tag=\"parent-link\"><a class=\"internal-link\" href=\"Projects/Plan.md#^abc123\" data-tpl-attr-var-href=\"blockRef\">⬆️</a></span> Fix login 📅 2025-01-01 ✅ 2025-01-02 ^blk-1",
	],
	[
		"crm-payment (crm.abandoned)",
		"- [ ] Fix login <span data-template-wrapper=\"tpl-ID\" data-template-key=\"crm.abandoned\" data-order-tag=\"crm-payment\"><mark style=\"background: #FF5582A6;\"><strong>Abandoned</strong></mark></span> ✅ 2025-01-02 📅 2025-01-01 ^blk-1",
		"- [ ] Fix login <span data-template-wrapper=\"tpl-ID\" data-template-key=\"crm.abandoned\" data-order-tag=\"crm-payment\"><mark style=\"background: #FF5582A6;\"><strong>Abandoned</strong></mark></span> 📅 2025-01-01 ✅ 2025-01-02 ^blk-1",
	],
	[
		"crm-commission (crm.commission)",
		"- [ ] Fix login <span data-template-wrapper=\"tpl-ID\" data-template-key=\"crm.commission\" data-order-tag=\"crm-commission\"><mark style=\"background: #53BDA5;\"><strong>Commission Paid <span data-tpl-var=\"currency\">€</span><span data-tpl-var=\"paidAmount\">1,250.00</span> / <span data-tpl-var=\"currency\">€</span><span data-tpl-var=\"totalAmount\">5,000.00</span></strong></mark></span> ✅ 2025-01-02 📅 2025-01-01 ^blk-1",
		"- [ ] Fix login <span data-template-wrapper=\"tpl-ID\" data-template-key=\"crm.commission\" data-order-tag=\"crm-commission\"><mark style=\"background: #53BDA5;\"><strong>Commission Paid <span data-tpl-var=\"currency\">€</span><span data-tpl-var=\"paidAmount\">1,250.00</span> / <span data-tpl-var=\"currency\">€</span><span data-tpl-var=\"totalAmount\">5,000.00</span></strong></mark></span> 📅 2025-01-01 ✅ 2025-01-02 ^blk-1",
	],
	[
		"priority (prio.kano.dissatisfier)",
		"- [ ] Fix login <span data-template-wrapper=\"tpl-ID\" data-template-key=\"prio.kano.dissatisfier\" data-order-tag=\"priority\"><mark style=\"background: #FF5582A6;\"><strong>⬅️ Kano - Dissatisfier:</strong></mark> <span data-tpl-var=\"details\">Sample details</span></span> ✅ 2025-01-02 📅 2025-01-01 ^blk-1",
		"- [ ] Fix login <span data-template-wrapper=\"tpl-ID\" data-template-key=\"prio.kano.dissatisfier\" data-order-tag=\"priority\"><mark style=\"background: #FF5582A6;\"><strong>⬅️ Kano - Dissatisfier:</strong></mark> <span data-tpl-var=\"details\">Sample details</span></span> 📅 2025-01-01 ✅ 2025-01-02 ^blk-1",
	],
	[
		"no order tag (prio.moscow.must)",
		"- [ ] Fix login <span data-template-wrapper=\"tpl-ID\" data-template-key=\"prio.moscow.must\"><mark style=\"background: #00A86B;\"><strong>❗Must-Have:</strong></mark> <span data-tpl-var=\"details\">Sample details</span></span> ✅ 2025-01-02 📅 2025-01-01 ^blk-1",
		"- [ ] Fix login <span data-template-wrapper=\"tpl-ID\" data-template-key=\"prio.moscow.must\"><mark style=\"background: #00A86B;\"><strong>❗Must-Have:</strong></mark> <span data-tpl-var=\"details\">Sample details</span></span> 📅 2025-01-01 ✅ 2025-01-02 ^blk-1",
	],
	[
		"metadata (workflows.metadata.branch)",
		"- [ ] Fix login <span data-template-wrapper=\"tpl-ID\" data-template-key=\"workflows.metadata.branch\" data-order-tag=\"metadata\"><mark style=\"background: #000000; color: #878787;\"><strong><a href=\"https://example.com/x/1\">🪵 </a></strong></mark></span> ✅ 2025-01-02 📅 2025-01-01 ^blk-1",
		"- [ ] Fix login <span data-template-wrapper=\"tpl-ID\" data-template-key=\"workflows.metadata.branch\" data-order-tag=\"metadata\"><mark style=\"background: #000000; color: #878787;\"><strong><a href=\"https://example.com/x/1\">🪵 </a></strong></mark></span> 📅 2025-01-01 ✅ 2025-01-02 ^blk-1",
	],
	[
		"state (workflows.states.blocked)",
		"- [ ] Fix login <span data-template-wrapper=\"tpl-ID\" data-template-key=\"workflows.states.blocked\" data-order-tag=\"state\"><mark style=\"background: #FF5582A6;\">⛔ <strong>Requires: <a class=\"internal-link\" href=\"Projects/Plan.md#^blk9\" data-tpl-attr-var-href=\"href\"><span data-tpl-var=\"details\">Sample details</span></a></strong></mark></span> ✅ 2025-01-02 📅 2025-01-01 ^blk-1",
		"- [ ] Fix login <span data-template-wrapper=\"tpl-ID\" data-template-key=\"workflows.states.blocked\" data-order-tag=\"state\"><mark style=\"background: #FF5582A6;\">⛔ <strong>Requires: <a class=\"internal-link\" href=\"Projects/Plan.md#^blk9\" data-tpl-attr-var-href=\"href\"><span data-tpl-var=\"details\">Sample details</span></a></strong></mark></span> 📅 2025-01-01 ✅ 2025-01-02 ^blk-1",
	],
	[
		"internal-link (obsidian.internalInlineLink)",
		"- [ ] Fix login <span data-template-wrapper=\"tpl-ID\" data-template-key=\"obsidian.internalInlineLink\" data-order-tag=\"internal-link\"><mark style=\"background: #CACFD9A6;\"><a class=\"internal-link\" href=\"Projects/Plan.md#^blk9\" data-tpl-attr-var-href=\"href\"><span data-tpl-var=\"linkContent\">Open Roadmap</span></a></mark></span> ✅ 2025-01-02 📅 2025-01-01 ^blk-1",
		"- [ ] Fix login <span data-template-wrapper=\"tpl-ID\" data-template-key=\"obsidian.internalInlineLink\" data-order-tag=\"internal-link\"><mark style=\"background: #CACFD9A6;\"><a class=\"internal-link\" href=\"Projects/Plan.md#^blk9\" data-tpl-attr-var-href=\"href\"><span data-tpl-var=\"linkContent\">Open Roadmap</span></a></mark></span> 📅 2025-01-01 ✅ 2025-01-02 ^blk-1",
	],
	[
		"timestamp (obsidian.timestamp)",
		"- [ ] Fix login <span data-template-wrapper=\"tpl-ID\" data-template-key=\"obsidian.timestamp\" data-order-tag=\"timestamp\"><mark style=\"background: #CACFD9A6;\"><strong>🕔 {{date:YYYY-MM-DD HH:MM:SS}}</strong></mark></span> ✅ 2025-01-02 📅 2025-01-01 ^blk-1",
		"- [ ] Fix login <span data-template-wrapper=\"tpl-ID\" data-template-key=\"obsidian.timestamp\" data-order-tag=\"timestamp\"><mark style=\"background: #CACFD9A6;\"><strong>🕔 {{date:YYYY-MM-DD HH:MM:SS}}</strong></mark></span> 📅 2025-01-01 ✅ 2025-01-02 ^blk-1",
	],
	[
		"datestamp (obsidian.datestamp)",
		"- [ ] Fix login <span data-template-wrapper=\"tpl-ID\" data-template-key=\"obsidian.datestamp\" data-order-tag=\"datestamp\"><mark style=\"background: #CACFD9A6;\"><strong>🕔 {{date:YYYY-MM-DD}}</strong></mark></span> ✅ 2025-01-02 📅 2025-01-01 ^blk-1",
		"- [ ] Fix login <span data-template-wrapper=\"tpl-ID\" data-template-key=\"obsidian.datestamp\" data-order-tag=\"datestamp\"><mark style=\"background: #CACFD9A6;\"><strong>🕔 {{date:YYYY-MM-DD}}</strong></mark></span> 📅 2025-01-01 ✅ 2025-01-02 ^blk-1",
	],
	[
		"every order tag on one line, scrambled",
		"- [ ] <span data-template-wrapper=\"tpl-ID\" data-template-key=\"obsidian.datestamp\" data-order-tag=\"datestamp\"><mark style=\"background: #CACFD9A6;\"><strong>🕔 {{date:YYYY-MM-DD}}</strong></mark></span> <span data-template-wrapper=\"tpl-ID\" data-template-key=\"workflows.metadata.branch\" data-order-tag=\"metadata\"><mark style=\"background: #000000; color: #878787;\"><strong><a href=\"https://example.com/x/1\">🪵 </a></strong></mark></span> <span data-template-wrapper=\"tpl-ID\" data-template-key=\"prio.kano.dissatisfier\" data-order-tag=\"priority\"><mark style=\"background: #FF5582A6;\"><strong>⬅️ Kano - Dissatisfier:</strong></mark> <span data-tpl-var=\"details\">Sample details</span></span> <span data-template-wrapper=\"tpl-ID\" data-template-key=\"workflows.states.blocked\" data-order-tag=\"state\"><mark style=\"background: #FF5582A6;\">⛔ <strong>Requires: <a class=\"internal-link\" href=\"Projects/Plan.md#^blk9\" data-tpl-attr-var-href=\"href\"><span data-tpl-var=\"details\">Sample details</span></a></strong></mark></span> <span data-template-wrapper=\"tpl-ID\" data-template-key=\"crm.abandoned\" data-order-tag=\"crm-payment\"><mark style=\"background: #FF5582A6;\"><strong>Abandoned</strong></mark></span> Ship it <span data-template-wrapper=\"tpl-ID\" data-template-key=\"agile.epic\" data-order-tag=\"artifact-item-type\"><mark style=\"background: #CACFD9A6;\"><strong>🏆 <span data-tpl-var=\"title\">Sample title</span>:</strong></mark> <span data-tpl-var=\"details\">Sample details</span></span> <span data-template-wrapper=\"tpl-ID\" data-template-key=\"prio.moscow.must\"><mark style=\"background: #00A86B;\"><strong>❗Must-Have:</strong></mark> <span data-tpl-var=\"details\">Sample details</span></span> <span data-template-wrapper=\"tpl-ID\" data-template-key=\"agile.parentLink\" data-order-tag=\"parent-link\"><a class=\"internal-link\" href=\"Projects/Plan.md#^abc123\" data-tpl-attr-var-href=\"blockRef\">⬆️</a></span> <span data-template-wrapper=\"tpl-ID\" data-template-key=\"obsidian.timestamp\" data-order-tag=\"timestamp\"><mark style=\"background: #CACFD9A6;\"><strong>🕔 {{date:YYYY-MM-DD HH:MM:SS}}</strong></mark></span> <span data-template-wrapper=\"tpl-ID\" data-template-key=\"crm.commission\" data-order-tag=\"crm-commission\"><mark style=\"background: #53BDA5;\"><strong>Commission Paid <span data-tpl-var=\"currency\">€</span><span data-tpl-var=\"paidAmount\">1,250.00</span> / <span data-tpl-var=\"currency\">€</span><span data-tpl-var=\"totalAmount\">5,000.00</span></strong></mark></span> <span data-template-wrapper=\"tpl-ID\" data-template-key=\"obsidian.internalInlineLink\" data-order-tag=\"internal-link\"><mark style=\"background: #CACFD9A6;\"><a class=\"internal-link\" href=\"Projects/Plan.md#^blk9\" data-tpl-attr-var-href=\"href\"><span data-tpl-var=\"linkContent\">Open Roadmap</span></a></mark></span> 💤 ⏳ 2025-03-03 🛫 2025-01-01 ^id9",
		"- [ ] <span data-template-wrapper=\"tpl-ID\" data-template-key=\"agile.parentLink\" data-order-tag=\"parent-link\"><a class=\"internal-link\" href=\"Projects/Plan.md#^abc123\" data-tpl-attr-var-href=\"blockRef\">⬆️</a></span> <span data-template-wrapper=\"tpl-ID\" data-template-key=\"agile.epic\" data-order-tag=\"artifact-item-type\"><mark style=\"background: #CACFD9A6;\"><strong>🏆 <span data-tpl-var=\"title\">Sample title</span>:</strong></mark> <span data-tpl-var=\"details\">Sample details</span></span> Ship it <span data-template-wrapper=\"tpl-ID\" data-template-key=\"workflows.states.blocked\" data-order-tag=\"state\"><mark style=\"background: #FF5582A6;\">⛔ <strong>Requires: <a class=\"internal-link\" href=\"Projects/Plan.md#^blk9\" data-tpl-attr-var-href=\"href\"><span data-tpl-var=\"details\">Sample details</span></a></strong></mark></span> <span data-template-wrapper=\"tpl-ID\" data-template-key=\"crm.commission\" data-order-tag=\"crm-commission\"><mark style=\"background: #53BDA5;\"><strong>Commission Paid <span data-tpl-var=\"currency\">€</span><span data-tpl-var=\"paidAmount\">1,250.00</span> / <span data-tpl-var=\"currency\">€</span><span data-tpl-var=\"totalAmount\">5,000.00</span></strong></mark></span> <span data-template-wrapper=\"tpl-ID\" data-template-key=\"crm.abandoned\" data-order-tag=\"crm-payment\"><mark style=\"background: #FF5582A6;\"><strong>Abandoned</strong></mark></span> <span data-template-wrapper=\"tpl-ID\" data-template-key=\"obsidian.datestamp\" data-order-tag=\"datestamp\"><mark style=\"background: #CACFD9A6;\"><strong>🕔 {{date:YYYY-MM-DD}}</strong></mark></span> <span data-template-wrapper=\"tpl-ID\" data-template-key=\"obsidian.internalInlineLink\" data-order-tag=\"internal-link\"><mark style=\"background: #CACFD9A6;\"><a class=\"internal-link\" href=\"Projects/Plan.md#^blk9\" data-tpl-attr-var-href=\"href\"><span data-tpl-var=\"linkContent\">Open Roadmap</span></a></mark></span> <span data-template-wrapper=\"tpl-ID\" data-template-key=\"prio.kano.dissatisfier\" data-order-tag=\"priority\"><mark style=\"background: #FF5582A6;\"><strong>⬅️ Kano - Dissatisfier:</strong></mark> <span data-tpl-var=\"details\">Sample details</span></span> <span data-template-wrapper=\"tpl-ID\" data-template-key=\"obsidian.timestamp\" data-order-tag=\"timestamp\"><mark style=\"background: #CACFD9A6;\"><strong>🕔 {{date:YYYY-MM-DD HH:MM:SS}}</strong></mark></span> <span data-template-wrapper=\"tpl-ID\" data-template-key=\"prio.moscow.must\"><mark style=\"background: #00A86B;\"><strong>❗Must-Have:</strong></mark> <span data-tpl-var=\"details\">Sample details</span></span> <span data-template-wrapper=\"tpl-ID\" data-template-key=\"workflows.metadata.branch\" data-order-tag=\"metadata\"><mark style=\"background: #000000; color: #878787;\"><strong><a href=\"https://example.com/x/1\">🪵 </a></strong></mark></span> 🛫 2025-01-01 ⏳ 2025-03-03 💤 ^id9",
	],
	[
		"star bullet, no task text",
		"* [x] <span data-template-wrapper=\"tpl-ID\" data-template-key=\"agile.epic\" data-order-tag=\"artifact-item-type\"><mark style=\"background: #CACFD9A6;\"><strong>🏆 <span data-tpl-var=\"title\">Sample title</span>:</strong></mark> <span data-tpl-var=\"details\">Sample details</span></span>",
		"* [x] <span data-template-wrapper=\"tpl-ID\" data-template-key=\"agile.epic\" data-order-tag=\"artifact-item-type\"><mark style=\"background: #CACFD9A6;\"><strong>🏆 <span data-tpl-var=\"title\">Sample title</span>:</strong></mark> <span data-tpl-var=\"details\">Sample details</span></span> ",
	],
	[
		"two state chips keep their order",
		"- [ ] <span data-template-wrapper=\"tpl-ID\" data-template-key=\"workflows.states.pending\" data-order-tag=\"state\"><mark style=\"background: #FEE12B;\">🕒 Resumes: <strong>2026-03-01</strong></mark></span> <span data-template-wrapper=\"tpl-ID\" data-template-key=\"workflows.states.blocked\" data-order-tag=\"state\"><mark style=\"background: #FF5582A6;\">⛔ <strong>Requires: <a class=\"internal-link\" href=\"Projects/Plan.md#^blk9\" data-tpl-attr-var-href=\"href\"><span data-tpl-var=\"details\">Sample details</span></a></strong></mark></span> x",
		"- [ ] x <span data-template-wrapper=\"tpl-ID\" data-template-key=\"workflows.states.pending\" data-order-tag=\"state\"><mark style=\"background: #FEE12B;\">🕒 Resumes: <strong>2026-03-01</strong></mark></span> <span data-template-wrapper=\"tpl-ID\" data-template-key=\"workflows.states.blocked\" data-order-tag=\"state\"><mark style=\"background: #FF5582A6;\">⛔ <strong>Requires: <a class=\"internal-link\" href=\"Projects/Plan.md#^blk9\" data-tpl-attr-var-href=\"href\"><span data-tpl-var=\"details\">Sample details</span></a></strong></mark></span> ",
	],

	];

	it.each(golden)("%s", (_name, input, expected) => {
		expect(f(input)).toBe(expected);
	});

	it("built-in chips as rendered (double space after <mark) keep that space and the 5a90994 order", () => {
		const rendered = `<span data-template-wrapper="tpl-ID" data-template-key="agile.epic" data-order-tag="artifact-item-type"><mark  style="background: #CACFD9A6;"><strong>🏆 <span data-tpl-var="title">Sample title</span></strong></mark></span>`;
		expect(f(`- [ ] Fix login ${rendered} ✅ 2025-01-02 📅 2025-01-01`)).toBe(
			`- [ ] ${rendered} Fix login 📅 2025-01-01 ✅ 2025-01-02`
		);
	});
});
