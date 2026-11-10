import { describe, expect, it } from "vitest";
import {
	validateCustomTemplateText,
	type CustomTemplateValidation,
} from "@features/templating-engine/domain/custom-template-schema";
import { isCssColor } from "@features/templating-engine/domain/css-color";
import tokens from "@features/templating-engine/domain/tokens.json";

/** A valid template: the GP3 Spike. Rows below change one thing at a time. */
const spike = () => ({
	id: "custom.spike",
	label: "Spike",
	emoji: "🧪",
	color: "#7E57C2",
	fields: [
		{ name: "title", required: true },
		{ name: "timebox", placeholder: "e.g. 2d" },
	],
	text: "{{title}}{{#timebox}} ({{timebox}}){{/timebox}}",
});

type Obj = Record<string, unknown>;
const json = (o: Obj) => JSON.stringify(o);
const withKey = (key: string, value: unknown): string => {
	const o = spike() as Obj;
	o[key] = value;
	return json(o);
};
const withField = (patch: Obj): string => {
	const o = spike();
	o.fields = [{ name: "title", required: true, ...patch }, o.fields[1]];
	return json(o as unknown as Obj);
};
const withText = (text: string, fieldNames: string[] = ["title", "timebox"]) =>
	json({ ...spike(), fields: fieldNames.map((name) => ({ name })), text });

const run = (text: string, others: string[] = []): CustomTemplateValidation =>
	validateCustomTemplateText(text, others);

interface Row {
	rule: string;
	pass: string;
	fail: string;
	/** Exact expected error, "path: message". */
	error: string;
	others?: string[];
}

const rows: Row[] = [
	// ---- id ----
	{
		rule: "id is required",
		pass: json(spike() as Obj),
		fail: json({ ...spike(), id: undefined }),
		error: "id: required",
	},
	{
		rule: "id is a string",
		pass: withKey("id", "custom.a"),
		fail: withKey("id", 5),
		error: "id: must be a string",
	},
	{
		rule: 'id starts with "custom."',
		pass: withKey("id", "custom.ok"),
		fail: withKey("id", "agile.epic"),
		error: 'id: must start with "custom."',
	},
	{
		rule: "id needs a name after the prefix",
		pass: withKey("id", "custom.x"),
		fail: withKey("id", "custom."),
		error: 'id: needs a name after "custom."',
	},
	{
		rule: "id uses only [a-z0-9.-]",
		pass: withKey("id", "custom.a-b.c9"),
		fail: withKey("id", "custom.Spike_1"),
		error: "id: may only contain a-z, 0-9, . and -",
	},
	{
		rule: "id is unique (against the ids already taken)",
		pass: withKey("id", "custom.fresh"),
		fail: withKey("id", "custom.taken"),
		error: 'id: "custom.taken" is already used by another template',
		others: ["agile.epic", "custom.taken"],
	},
	// ---- label ----
	{
		rule: "label is required",
		pass: withKey("label", "Spike"),
		fail: json({ ...spike(), label: undefined }),
		error: "label: required",
	},
	{
		rule: "label is not blank",
		pass: withKey("label", "🧪"),
		fail: withKey("label", "   "),
		error: "label: required",
	},
	{
		rule: "label is a string",
		pass: withKey("label", "Ünï"),
		fail: withKey("label", 3),
		error: "label: must be a string",
	},
	// ---- emoji ----
	{
		rule: "emoji is a string",
		pass: withKey("emoji", "🚀"),
		fail: withKey("emoji", 1),
		error: "emoji: must be a string",
	},
	// ---- colours ----
	{
		rule: "color is a string",
		pass: withKey("color", "tomato"),
		fail: withKey("color", 12),
		error: "color: must be a string",
	},
	{
		rule: "color is a CSS colour (no declaration smuggling)",
		pass: withKey("color", "rgba(1, 2, 3, 0.5)"),
		fail: withKey("color", "red; background:url(x)"),
		error: "color: must be a CSS colour (hex, rgb(), rgba(), hsl(), hsla() or a colour name)",
	},
	{
		rule: "textColor is a string",
		pass: withKey("textColor", "#fff"),
		fail: withKey("textColor", false),
		error: "textColor: must be a string",
	},
	{
		rule: "textColor is a CSS colour",
		pass: withKey("textColor", "hsl(10, 20%, 30%)"),
		fail: withKey("textColor", "expression(alert(1))"),
		error: "textColor: must be a CSS colour (hex, rgb(), rgba(), hsl(), hsla() or a colour name)",
	},
	// ---- allowedOn ----
	{
		rule: "allowedOn accepts a string",
		pass: withKey("allowedOn", "task"),
		fail: withKey("allowedOn", "page"),
		error: "allowedOn: must be task, list or any",
	},
	{
		rule: "allowedOn accepts an array of task|list|any",
		pass: withKey("allowedOn", ["task", "list"]),
		fail: withKey("allowedOn", ["task", "bad"]),
		error: "allowedOn[1]: must be task, list or any",
	},
	{
		rule: "allowedOn is not empty",
		pass: withKey("allowedOn", ["any"]),
		fail: withKey("allowedOn", []),
		error: "allowedOn: must not be empty",
	},
	// ---- topLevel / orderTag ----
	{
		rule: "topLevel is a boolean",
		pass: withKey("topLevel", true),
		fail: withKey("topLevel", "yes"),
		error: "topLevel: must be true or false",
	},
	{
		rule: "orderTag is one of the four tags",
		pass: withKey("orderTag", "artifact-item-type"),
		fail: withKey("orderTag", "crm-payment"),
		error: "orderTag: must be artifact-item-type, parent-link, state or metadata",
	},
	// ---- fields ----
	{
		rule: "fields is an array",
		pass: withKey("fields", [{ name: "title" }]).replace(
			"{{#timebox}} ({{timebox}}){{/timebox}}",
			""
		),
		fail: withKey("fields", "title"),
		error: "fields: must be an array",
	},
	{
		rule: "a field is an object",
		pass: withField({}),
		fail: withKey("fields", ["title"]),
		error: "fields[0]: must be an object",
	},
	{
		rule: "field name is required",
		pass: withField({ name: "title" }),
		fail: withField({ name: undefined }),
		error: "fields[0].name: required",
	},
	{
		rule: "field name is a string",
		pass: withField({ name: "title" }),
		fail: withField({ name: 4 }),
		error: "fields[0].name: must be a string",
	},
	{
		rule: "field name is a plain identifier (no __proto__, spaces, leading _)",
		pass: withField({ name: "title" }),
		fail: withField({ name: "__proto__" }),
		error: "fields[0].name: must start with a letter and contain only letters, digits, _ and -",
	},
	{
		rule: "field names are unique",
		pass: json(spike() as Obj),
		fail: json({
			...spike(),
			fields: [{ name: "title" }, { name: "title" }, { name: "timebox" }],
		}),
		error: 'fields[1].name: "title" is declared twice',
	},
	{
		rule: "field label is a string",
		pass: withField({ label: "Title" }),
		fail: withField({ label: 9 }),
		error: "fields[0].label: must be a string",
	},
	{
		rule: "field type is text, textarea or dropdown",
		pass: withField({ type: "textarea" }),
		fail: withField({ type: "number" }),
		error: "fields[0].type: must be text, textarea or dropdown",
	},
	{
		rule: "field type blockSelect is rejected (F6)",
		pass: withField({ type: "text" }),
		fail: withField({ type: "blockSelect" }),
		error: "fields[0].type: must be text, textarea or dropdown",
	},
	{
		rule: "field required is a boolean",
		pass: withField({ required: false }),
		fail: withField({ required: "true" }),
		error: "fields[0].required: must be true or false",
	},
	{
		rule: "field placeholder is a string",
		pass: withField({ placeholder: "p" }),
		fail: withField({ placeholder: 1 }),
		error: "fields[0].placeholder: must be a string",
	},
	{
		rule: "field defaultValue is a string",
		pass: withField({ defaultValue: "d" }),
		fail: withField({ defaultValue: 1 }),
		error: "fields[0].defaultValue: must be a string",
	},
	{
		rule: "field description is a string",
		pass: withField({ description: "d" }),
		fail: withField({ description: {} }),
		error: "fields[0].description: must be a string",
	},
	{
		rule: "options are only allowed on a dropdown",
		pass: withField({ type: "dropdown", options: ["a"] }),
		fail: withField({ type: "text", options: ["a"] }),
		error: "fields[0].options: only allowed when type is dropdown",
	},
	{
		rule: "a dropdown needs options",
		pass: withField({ type: "dropdown", options: ["a"] }),
		fail: withField({ type: "dropdown" }),
		error: "fields[0].options: required for a dropdown",
	},
	{
		rule: "options is an array",
		pass: withField({ type: "dropdown", options: ["a"] }),
		fail: withField({ type: "dropdown", options: "a" }),
		error: "fields[0].options: must be an array",
	},
	{
		rule: "options is not empty",
		pass: withField({ type: "dropdown", options: ["a"] }),
		fail: withField({ type: "dropdown", options: [] }),
		error: "fields[0].options: must have at least one option",
	},
	{
		rule: "an option is a string or { label, value }",
		pass: withField({
			type: "dropdown",
			options: ["a", { label: "B", value: "b" }],
		}),
		fail: withField({ type: "dropdown", options: [3] }),
		error: "fields[0].options[0]: must be a string or { label, value }",
	},
	{
		rule: "an option object needs a value",
		pass: withField({ type: "dropdown", options: [{ label: "B", value: "b" }] }),
		fail: withField({ type: "dropdown", options: [{ label: "B" }] }),
		error: "fields[0].options[0].value: required",
	},
	{
		rule: "an option object has no unknown keys",
		pass: withField({ type: "dropdown", options: [{ label: "B", value: "b" }] }),
		fail: withField({
			type: "dropdown",
			options: [{ label: "B", value: "b", x: 1 }],
		}),
		error: "fields[0].options[0].x: unknown key",
	},
	{
		rule: "option values are unique",
		pass: withField({ type: "dropdown", options: ["a", "b"] }),
		fail: withField({ type: "dropdown", options: ["a", "a"] }),
		error: 'fields[0].options: value "a" is used twice',
	},
	{
		rule: "defaultValue is one of the dropdown options",
		pass: withField({ type: "dropdown", options: ["a", "b"], defaultValue: "b" }),
		fail: withField({ type: "dropdown", options: ["a", "b"], defaultValue: "c" }),
		error: "fields[0].defaultValue: must be one of the options",
	},
	// ---- text ----
	{
		rule: "text is required",
		pass: json(spike() as Obj),
		fail: json({ ...spike(), text: undefined }),
		error: "text: required",
	},
	{
		rule: "text is a string",
		pass: json(spike() as Obj),
		fail: withKey("text", 7),
		error: "text: must be a string",
	},
	// ---- G14 pattern ----
	{
		rule: "pattern: {{x}} needs a matching field",
		pass: withText("{{title}} {{timebox}}"),
		fail: withText("{{title}} {{timebox}} {{nope}}"),
		error: 'text: "{{nope}}" has no matching field',
	},
	{
		rule: "pattern: a declared field must be used",
		pass: withText("{{title}} {{timebox}}"),
		fail: withText("{{title}}"),
		error: 'fields[1].name: "timebox" is never used in text',
	},
	{
		rule: "pattern: a section is closed",
		pass: withText("{{#timebox}}{{title}}{{timebox}}{{/timebox}}"),
		fail: withText("{{title}}{{#timebox}}{{timebox}}"),
		error: 'text: "{{#timebox}}" is never closed',
	},
	{
		rule: "pattern: a section is closed by its own name",
		pass: withText("{{#timebox}}{{timebox}}{{/timebox}}{{title}}"),
		fail: withText("{{#timebox}}{{timebox}}{{/title}}{{title}}"),
		error: 'text: "{{#timebox}}" is closed by "{{/title}}"',
	},
	{
		rule: "pattern: no closing tag without an opening one",
		pass: withText("{{#timebox}}{{timebox}}{{/timebox}}{{title}}"),
		fail: withText("{{title}}{{timebox}}{{/timebox}}"),
		error: 'text: "{{/timebox}}" has no matching "{{#timebox}}"',
	},
	{
		rule: "pattern: sections cannot nest",
		pass: withText("{{#title}}{{title}}{{/title}}{{#timebox}}{{timebox}}{{/timebox}}"),
		fail: withText("{{#title}}{{#timebox}}{{title}}{{timebox}}{{/timebox}}{{/title}}"),
		error: 'text: sections cannot be nested ("{{#timebox}}" inside "{{#title}}")',
	},
	{
		rule: "pattern: a section needs a matching field",
		pass: withText("{{#timebox}}{{timebox}}{{/timebox}}{{title}}"),
		fail: withText("{{#nope}}x{{/nope}}{{title}}{{timebox}}"),
		error: 'text: "{{#nope}}" has no matching field',
	},
	{
		rule: "pattern: a single line",
		pass: withText("{{title}} {{timebox}}"),
		fail: json({ ...spike(), text: "{{title}}\n{{timebox}}" }),
		error: "text: must be a single line (no newlines)",
	},
	{
		rule: "pattern: tags are closed",
		pass: withText("{{title}} {{timebox}}"),
		fail: withText("{{title}} {{timebox}} {{oops"),
		error: 'text: unclosed "{{" at position 22',
	},
	{
		rule: "pattern: no empty tag",
		pass: withText("{{title}} {{timebox}}"),
		fail: withText("{{title}} {{timebox}} {{ }}"),
		error: "text: empty tag at position 22",
	},
	{
		rule: "pattern: no code in a tag",
		pass: withText("{{title}} {{timebox}}"),
		fail: withText("{{title}} {{timebox}} {{title.x}}"),
		error: 'text: invalid tag "{{title.x}}"',
	},
	// ---- unknown keys ----
	...["parent", "hiddenFromDynamicCommands", "render", "sequences", "hidden", "insertWorkflows"].map(
		(key): Row => ({
			rule: `unknown key "${key}" is an error`,
			pass: json(spike() as Obj),
			fail: withKey(key, key === "render" ? "() => 1" : true),
			error: `${key}: unknown key`,
		})
	),
	{
		rule: "unknown key inside a field is an error",
		pass: withField({}),
		fail: withField({ hidden: true }),
		error: "fields[0].hidden: unknown key",
	},
];

describe("custom template validator: one passing and one failing row per rule", () => {
	it.each(rows)("$rule", ({ pass, fail, error, others }) => {
		const ok = run(pass, others ?? []);
		expect(ok.errors).toEqual([]);
		expect(ok.ok).toBe(true);
		expect(ok.spec).not.toBeNull();

		const bad = run(fail, others ?? []);
		expect(bad.ok).toBe(false);
		expect(bad.spec).toBeNull();
		expect(bad.messages).toContain(error);
	});
});

describe("custom template validator: errors, paths and defaults", () => {
	it("passes the JSON.parse message through verbatim, with no path", () => {
		const text = '{"id": "custom.x",';
		let expected = "";
		try {
			JSON.parse(text);
		} catch (e) {
			expected = (e as Error).message;
		}
		expect(expected).not.toBe("");
		const res = run(text);
		expect(res.ok).toBe(false);
		expect(res.errors).toEqual([{ path: "", message: expected }]);
		expect(res.messages).toEqual([expected]);
	});

	it("rejects JSON that is not an object", () => {
		for (const t of ["[]", "5", "null", '"x"']) {
			expect(run(t).messages).toEqual(["template: must be a JSON object"]);
		}
	});

	it("names the path of a field error: fields[1].name: required", () => {
		const res = run(
			json({
				...spike(),
				fields: [{ name: "title" }, { label: "No name" }],
				text: "{{title}}",
			})
		);
		expect(res.messages).toContain("fields[1].name: required");
		expect(res.errors.find((e) => e.path === "fields[1].name")?.message).toBe(
			"required"
		);
	});

	it("reports every error at once, in key order", () => {
		const res = run(json({ id: "bad", label: 1, text: "{{x}}", parent: [] }));
		expect(res.messages).toEqual([
			"parent: unknown key",
			'id: must start with "custom."',
			"label: must be a string",
			'text: "{{x}}" has no matching field',
		]);
	});

	it("normalises a valid template and fills the defaults", () => {
		const res = run(
			json({ id: "custom.min", label: "Min", text: "Hello" })
		);
		expect(res.ok).toBe(true);
		expect(res.spec).toMatchObject({
			id: "custom.min",
			label: "Min",
			emoji: "",
			color: tokens.colors.artifactGrey,
			allowedOn: ["any"],
			topLevel: false,
			orderTag: "metadata",
			fields: [],
		});
		expect(res.spec?.textColor).toBeUndefined();
	});

	it("normalises allowedOn: a string and an array both become an array", () => {
		expect(run(withKey("allowedOn", "task")).spec?.allowedOn).toEqual(["task"]);
		expect(run(withKey("allowedOn", ["task", "list"])).spec?.allowedOn).toEqual([
			"task",
			"list",
		]);
		expect(run(withKey("allowedOn", ["task", "task"])).spec?.allowedOn).toEqual([
			"task",
		]);
	});

	it("defaults a field label to the capitalised name, and type to text", () => {
		const f = run(json(spike() as Obj)).spec?.fields;
		expect(f?.map((x) => [x.name, x.label, x.type, x.required])).toEqual([
			["title", "Title", "text", true],
			["timebox", "Timebox", "text", false],
		]);
	});

	it("a plain-string dropdown option uses the same text as label and value", () => {
		const f = run(
			withField({ type: "dropdown", options: ["Low", { label: "High!", value: "high" }] })
		).spec?.fields[0];
		expect(f?.options).toEqual([
			{ label: "Low", value: "Low" },
			{ label: "High!", value: "high" },
		]);
	});

	it("never accepts a code-bearing key and never evaluates anything", () => {
		const res = run(withKey("render", "() => { throw new Error('boom') }"));
		expect(res.ok).toBe(false);
		expect(res.messages).toEqual(["render: unknown key"]);
	});

	it("sees __proto__ as a plain unknown key, not a prototype write", () => {
		const res = run('{"__proto__": {"polluted": true}, "id": "custom.p", "label": "P", "text": "x"}');
		expect(res.ok).toBe(false);
		expect(({} as Obj).polluted).toBeUndefined();
	});
});

describe("css colour check", () => {
	it.each([
		"#fff",
		"#ffff",
		"#7E57C2",
		"#CACFD9A6",
		"red",
		"RebeccaPurple",
		"transparent",
		"rgb(1,2,3)",
		"rgba(1, 2, 3, 0.5)",
		"rgb(1 2 3 / 50%)",
		"hsl(120, 50%, 50%)",
		"hsla(120deg, 50%, 50%, .3)",
	])("accepts %s", (c) => expect(isCssColor(c)).toBe(true));

	it.each([
		"",
		"  ",
		"#ff",
		"#fffff",
		"#gggggg",
		"notacolour",
		"red; background:url(x)",
		"red}body{color:red",
		"url(http://x/y.png)",
		"expression(alert(1))",
		"var(--x)",
		"rgb(1,2,expression(1))",
		"rgb(url(x), 1, 2)",
		"rgb(1,2)",
		"rgb(1,2,3,4,5)",
		"red !important",
		'red" onload="x',
	])("rejects %s", (c) => expect(isCssColor(c)).toBe(false));
});
