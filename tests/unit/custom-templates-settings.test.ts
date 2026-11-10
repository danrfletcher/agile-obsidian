import { describe, expect, it } from "vitest";
import {
	appendStarter,
	buildStarterText,
	formatCardStatus,
	nextStarterNumber,
	removeCard,
	usedStarterNumbers,
} from "@settings/app/custom-templates-settings";
import { validateCustomTemplateText } from "@features/templating-engine/domain/custom-template-schema";
import { validateCustomTemplateCard } from "@features/templating-engine/app/custom-templates";
import { listBuiltInTemplateIds } from "@features/templating-engine/domain/built-in-ids";

const card = (o: Record<string, unknown>) => JSON.stringify(o);
const withId = (id: string) =>
	card({ id, label: "x", fields: [], text: "x" });

// The starter from the plan (G11), written out literally on purpose.
const STARTER_1 =
	'{"id":"custom.template-1","label":"New template","emoji":"⭐","fields":[{"name":"title","required":true}],"text":"{{title}}"}';

describe("starter text", () => {
	it("is exactly the documented starter, with N in the id", () => {
		expect(buildStarterText(1)).toBe(STARTER_1);
		expect(buildStarterText(12)).toBe(
			STARTER_1.replace("custom.template-1", "custom.template-12")
		);
	});

	it("round-trips through the PR-5 validator as valid", () => {
		for (const n of [1, 2, 10, 123]) {
			const v = validateCustomTemplateText(
				buildStarterText(n),
				listBuiltInTemplateIds()
			);
			expect(v.errors).toEqual([]);
			expect(v.ok).toBe(true);
			expect(v.spec?.id).toBe(`custom.template-${n}`);
			expect(v.spec?.label).toBe("New template");
			expect(v.spec?.emoji).toBe("⭐");
		}
	});
});

describe("next starter id: the smallest unused N (I6, E15)", () => {
	it("is 1 for an empty section", () => {
		expect(nextStarterNumber([])).toBe(1);
	});

	it("counts up when cards 1..k exist", () => {
		expect(nextStarterNumber([withId("custom.template-1")])).toBe(2);
		expect(
			nextStarterNumber([
				withId("custom.template-1"),
				withId("custom.template-2"),
			])
		).toBe(3);
	});

	it("reuses a gap", () => {
		expect(
			nextStarterNumber([
				withId("custom.template-1"),
				withId("custom.template-3"),
			])
		).toBe(2);
		expect(nextStarterNumber([withId("custom.template-2")])).toBe(1);
	});

	it("does not depend on card order", () => {
		expect(
			nextStarterNumber([
				withId("custom.template-3"),
				withId("custom.template-1"),
			])
		).toBe(2);
	});

	it("counts a card that parses but fails validation (its id is still taken)", () => {
		// unknown key, no fields array, wrong colour: all invalid, id is custom.template-1
		const invalid = card({
			id: "custom.template-1",
			label: "x",
			bogus: true,
			text: "{{nope}}",
		});
		expect(validateCustomTemplateText(invalid, []).ok).toBe(false);
		expect(nextStarterNumber([invalid])).toBe(2);
	});

	it("counts an unparseable card by matching its raw text", () => {
		// missing closing brace
		expect(nextStarterNumber(['{"id":"custom.template-2","label":"x"'])).toBe(1);
		expect(
			nextStarterNumber([
				withId("custom.template-1"),
				'{"id":"custom.template-2","label":"x"',
				withId("custom.template-4"),
			])
		).toBe(3);
		// a half-typed id still holds its number
		expect(nextStarterNumber(['{"id":"custom.template-1'])).toBe(2);
		// trailing comma
		expect(nextStarterNumber(['{"id":"custom.template-1",}'])).toBe(2);
	});

	it("an invalid card whose raw text contains custom.template-2 still counts as used (E15)", () => {
		expect(
			nextStarterNumber([
				withId("custom.template-1"),
				'{"id": "custom.template-2", "label": ',
				withId("custom.template-3"),
			])
		).toBe(4);
		expect(
			nextStarterNumber([
				withId("custom.template-1"),
				'not json at all, but mentions "custom.template-2"',
				withId("custom.template-3"),
			])
		).toBe(4);
	});

	it("an empty card, a card with no string id, or a non-object uses no number", () => {
		expect(nextStarterNumber([""])).toBe(1);
		expect(nextStarterNumber(["   "])).toBe(1);
		expect(nextStarterNumber(["[]"])).toBe(1);
		expect(nextStarterNumber(["null"])).toBe(1);
		expect(nextStarterNumber(["42"])).toBe(1);
		expect(nextStarterNumber([card({ id: 1, label: "x" })])).toBe(1);
	});

	it("a parsed card only holds the number of its own id, not of text that mentions another", () => {
		const mentions = card({
			id: "custom.other",
			label: "see custom.template-1",
			text: "custom.template-2",
		});
		expect(usedStarterNumbers([mentions]).size).toBe(0);
		expect(nextStarterNumber([mentions])).toBe(1);
	});

	it("does not mistake near-misses for the numbered id", () => {
		const near = [
			withId("custom.template-"),
			withId("custom.template-01"),
			withId("custom.template-2x"),
			withId("custom.template-x"),
			withId("custom.templates-1"),
			withId("custom.template-1.b"),
			withId("agile.template-1"),
		];
		expect(nextStarterNumber(near)).toBe(1);
		// the same near-misses as raw, unparseable text
		const raw = near.map((t) => t.slice(0, -1));
		expect(nextStarterNumber(raw)).toBe(1);
	});

	it("is not thrown by huge numbers", () => {
		expect(
			nextStarterNumber([
				withId("custom.template-99999999999999999999999"),
				withId("custom.template-1"),
			])
		).toBe(2);
	});

	it("five Adds in a row number the cards 1 to 5", () => {
		let texts: string[] = [];
		for (let i = 0; i < 5; i++) texts = appendStarter(texts).texts;
		expect(texts.map((t) => (JSON.parse(t) as { id: string }).id)).toEqual([
			"custom.template-1",
			"custom.template-2",
			"custom.template-3",
			"custom.template-4",
			"custom.template-5",
		]);
	});
});

describe("Add and Delete as array operations", () => {
	it("Add appends the starter last and reports its position, without mutating the input", () => {
		const before = [withId("custom.a"), withId("custom.b")];
		const frozen = Object.freeze([...before]);
		const r = appendStarter(frozen);
		expect(r.texts).toEqual([...before, STARTER_1]);
		expect(r.index).toBe(2);
		expect(frozen).toEqual(before);
	});

	it("Add twice on an empty section gives template-1 then template-2, both valid (E15)", () => {
		const first = appendStarter([]);
		const second = appendStarter(first.texts);
		expect(second.texts.map((t) => (JSON.parse(t) as { id: string }).id)).toEqual(
			["custom.template-1", "custom.template-2"]
		);
		expect(second.index).toBe(1);
		for (let i = 0; i < second.texts.length; i++) {
			expect(validateCustomTemplateCard(second.texts, i).ok).toBe(true);
		}
	});

	it("Add reuses a gap and puts the new card at the end, not in the gap", () => {
		const t1 = buildStarterText(1);
		const t3 = buildStarterText(3);
		const r = appendStarter([t1, t3]);
		expect(r.texts).toEqual([t1, t3, buildStarterText(2)]);
		expect(r.index).toBe(2);
	});

	it("Delete removes only that card; the others keep their text and order", () => {
		const a = "A: any text, even invalid";
		const b = withId("custom.b");
		const c = "";
		const d = '{"id":';
		const all = [a, b, c, d];
		expect(removeCard(all, 0)).toEqual([b, c, d]);
		expect(removeCard(all, 1)).toEqual([a, c, d]);
		expect(removeCard(all, 2)).toEqual([a, b, d]);
		expect(removeCard(all, 3)).toEqual([a, b, c]);
		expect(all).toEqual([a, b, c, d]);
	});

	it("Delete of the only card leaves an empty list", () => {
		expect(removeCard([STARTER_1], 0)).toEqual([]);
	});

	it("Delete with a position that is not a card changes nothing", () => {
		const all = ["a", "b"];
		for (const i of [-1, 2, 99, 0.5, NaN]) {
			const out = removeCard(all, i);
			expect(out).toEqual(all);
			expect(out).not.toBe(all);
		}
	});

	it("Delete then Add reuses the freed number", () => {
		const two = appendStarter(appendStarter([]).texts).texts;
		const afterDelete = removeCard(two, 0); // template-1 is gone
		expect(appendStarter(afterDelete).texts[1]).toBe(buildStarterText(1));
	});
});

describe("status formatting", () => {
	const SYNTAX_TEXTS = [
		'{"id":',
		'{"id":"custom.a",}',
		'{"id":"custom.a"',
		"",
		"not json",
	];
	const parserMessage = (text: string): string => {
		try {
			JSON.parse(text);
		} catch (e) {
			return (e as Error).message;
		}
		throw new Error("expected a syntax error");
	};

	type Row = {
		name: string;
		texts: string[];
		index: number;
		valid: boolean;
		lines: string[];
	};

	const GOOD = {
		id: "custom.good",
		label: "Good",
		fields: [{ name: "title", required: true }],
		text: "{{title}}",
	};

	const rows: Row[] = [
		{
			name: "a valid definition",
			texts: [card(GOOD)],
			index: 0,
			valid: true,
			lines: ["Valid"],
		},
		{
			name: "a missing required key",
			texts: [card({ label: "x", text: "x" })],
			index: 0,
			valid: false,
			lines: ["id: required"],
		},
		{
			name: "an error inside a field, with an indexed path",
			texts: [
				card({
					id: "custom.a",
					label: "A",
					fields: [{ name: "title" }, {}],
					text: "{{title}}",
				}),
			],
			index: 0,
			valid: false,
			lines: ["fields[1].name: required"],
		},
		{
			name: "an unknown key",
			texts: [card({ ...GOOD, parent: "x" })],
			index: 0,
			valid: false,
			lines: ["parent: unknown key"],
		},
		{
			name: "a wrong id prefix",
			texts: [card({ ...GOOD, id: "epic" })],
			index: 0,
			valid: false,
			lines: ['id: must start with "custom."'],
		},
		{
			name: "a duplicate id shows on the later card only",
			texts: [card(GOOD), card(GOOD)],
			index: 1,
			valid: false,
			lines: ['id: "custom.good" is already used by another template'],
		},
		{
			name: "the earlier of two same-id cards stays valid",
			texts: [card(GOOD), card(GOOD)],
			index: 0,
			valid: true,
			lines: ["Valid"],
		},
		{
			name: "a built-in id",
			texts: [card({ ...GOOD, id: "agile.epic" })],
			index: 0,
			valid: false,
			lines: ['id: must start with "custom."'],
		},
		{
			name: "a text pattern error: tag with no matching field",
			texts: [card({ id: "custom.a", label: "A", text: "{{x}}" })],
			index: 0,
			valid: false,
			lines: ['text: "{{x}}" has no matching field'],
		},
		{
			name: "a text pattern error plus the unused field it causes",
			texts: [
				card({
					id: "custom.a",
					label: "A",
					fields: [{ name: "title" }],
					text: "{{title",
				}),
			],
			index: 0,
			valid: false,
			lines: [
				'text: unclosed "{{" at position 0',
				'fields[0].name: "title" is never used in text',
			],
		},
		{
			name: "a declared field that is never used in text",
			texts: [
				card({
					id: "custom.a",
					label: "A",
					fields: [{ name: "title" }],
					text: "plain",
				}),
			],
			index: 0,
			valid: false,
			lines: ['fields[0].name: "title" is never used in text'],
		},
		{
			name: "an empty string option, with the option index in the path",
			texts: [
				card({
					id: "custom.a",
					label: "A",
					fields: [{ name: "pick", type: "dropdown", options: ["a", ""] }],
					text: "{{pick}}",
				}),
			],
			index: 0,
			valid: false,
			lines: ["fields[0].options[1]: must not be empty"],
		},
		{
			name: "an option that is neither a string nor an object",
			texts: [
				card({
					id: "custom.a",
					label: "A",
					fields: [{ name: "pick", type: "dropdown", options: [5] }],
					text: "{{pick}}",
				}),
			],
			index: 0,
			valid: false,
			lines: ["fields[0].options[0]: must be a string or { label, value }"],
		},
		{
			name: "an option object missing its value (field and option indexes)",
			texts: [
				card({
					id: "custom.a",
					label: "A",
					fields: [
						{ name: "first" },
						{
							name: "pick",
							type: "dropdown",
							options: ["a", { label: "B" }],
						},
					],
					text: "{{first}} {{pick}}",
				}),
			],
			index: 0,
			valid: false,
			lines: ["fields[1].options[1].value: required"],
		},
		{
			name: "an option object with an unknown key",
			texts: [
				card({
					id: "custom.a",
					label: "A",
					fields: [
						{
							name: "pick",
							type: "dropdown",
							options: [{ label: "A", value: "a", extra: 1 }],
						},
					],
					text: "{{pick}}",
				}),
			],
			index: 0,
			valid: false,
			lines: ["fields[0].options[0].extra: unknown key"],
		},
		{
			name: "a JSON that is not an object",
			texts: ["[1,2]"],
			index: 0,
			valid: false,
			lines: ["template: must be a JSON object"],
		},
	];

	it.each(rows)("$name", ({ texts, index, valid, lines }) => {
		const status = formatCardStatus(validateCustomTemplateCard(texts, index));
		expect({ valid: status.valid, lines: status.lines }).toEqual({
			valid,
			lines,
		});
	});

	it.each(SYNTAX_TEXTS)(
		"a JSON syntax error is the parser's message, verbatim (%j)",
		(text) => {
			const status = formatCardStatus(validateCustomTemplateCard([text], 0));
			expect(status.valid).toBe(false);
			expect(status.lines).toEqual([parserMessage(text)]);
			// no path prefix and no rewording
			expect(status.lines[0]).not.toMatch(/^\w+: /);
		}
	);

	it("shows one line per error, in the validator's order, unaltered", () => {
		const texts = [
			card({ label: 1, unknownKey: 1, fields: "nope", text: "{{x}}" }),
		];
		const v = validateCustomTemplateCard(texts, 0);
		expect(v.messages.length).toBeGreaterThan(1);
		const status = formatCardStatus(v);
		expect(status.lines).toEqual(v.messages);
		// and the text pattern error is in there as the literal line
		expect(status.lines).toContain('text: "{{x}}" has no matching field');
	});

	it("passes validator messages through as given, including a bare message", () => {
		expect(formatCardStatus({ ok: false, messages: ["a.b[2]: x", "bare"] })).toEqual(
			{ valid: false, lines: ["a.b[2]: x", "bare"] }
		);
	});

	it("an ok result is Valid whatever else it carries", () => {
		expect(formatCardStatus({ ok: true, messages: [] })).toEqual({
			valid: true,
			lines: ["Valid"],
		});
	});

	it("a failed result with no message still shows a line", () => {
		expect(formatCardStatus({ ok: false, messages: [] })).toEqual({
			valid: false,
			lines: ["Invalid"],
		});
	});

	it("does not share the validator's array with the caller", () => {
		const messages = ["x"];
		const status = formatCardStatus({ ok: false, messages });
		status.lines.push("y");
		expect(messages).toEqual(["x"]);
	});
});
