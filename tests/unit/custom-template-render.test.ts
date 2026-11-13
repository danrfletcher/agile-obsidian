import { describe, expect, it } from "vitest";
import { validateCustomTemplateText } from "@features/templating-engine/domain/custom-template-schema";
import {
	buildCustomTemplateDefinition,
	renderCustomTemplate,
} from "@features/templating-engine/domain/custom-template-render";
import { presetTemplates } from "@features/templating-engine/domain/presets";
import type { TemplateDefinition } from "@features/templating-engine/domain/types";

// Instance ids are random per render.
const normalise = (html: string) =>
	html.replace(/data-template-wrapper="tpl-[a-z0-9]+"/g, 'data-template-wrapper="tpl-ID"');

function spec(o: Record<string, unknown>) {
	const res = validateCustomTemplateText(JSON.stringify(o), []);
	if (!res.spec) throw new Error(res.messages.join("; "));
	return res.spec;
}

const SPIKE = {
	id: "custom.spike",
	label: "Spike",
	emoji: "🧪",
	color: "#7E57C2",
	fields: [
		{ name: "title", required: true },
		{ name: "timebox" },
	],
	text: "{{title}}{{#timebox}} ({{timebox}}){{/timebox}}",
};

const render = (o: Record<string, unknown>, params?: Record<string, unknown>) =>
	normalise(renderCustomTemplate(spec(o), params));

describe("custom template rendering (G15)", () => {
	it("GP4: Spike with a timebox, exact HTML", () => {
		expect(render(SPIKE, { title: "Auth options", timebox: "2d" })).toBe(
			'<span data-template-wrapper="tpl-ID" data-template-key="custom.spike" data-order-tag="metadata">' +
				'<mark  style="background: #7E57C2;">🧪 ' +
				'<span data-tpl-var="title">Auth options</span>' +
				' (<span data-tpl-var="timebox">2d</span>)' +
				"</mark></span>"
		);
	});

	it("GP5: Spike without a timebox has no empty parentheses and no timebox span", () => {
		const html = render(SPIKE, { title: "Auth options", timebox: "" });
		expect(html).toBe(
			'<span data-template-wrapper="tpl-ID" data-template-key="custom.spike" data-order-tag="metadata">' +
				'<mark  style="background: #7E57C2;">🧪 ' +
				'<span data-tpl-var="title">Auth options</span>' +
				"</mark></span>"
		);
		expect(html).not.toContain("()");
		// A missing value and a whitespace-only value are the same as empty.
		expect(render(SPIKE, { title: "Auth options" })).toBe(html);
		expect(render(SPIKE, { title: "Auth options", timebox: "   " })).toBe(html);
	});

	it("no emoji: no leading space", () => {
		const html = render({ ...SPIKE, emoji: undefined }, { title: "T", timebox: "1d" });
		expect(html).toContain('<mark  style="background: #7E57C2;"><span data-tpl-var="title">T</span>');
		expect(html).not.toContain("> <span");
	});

	it("an emoji-only label and a unicode label render", () => {
		const html = render(
			{ id: "custom.u", label: "🔥", emoji: "🔥", text: "Ünïcödé ✓" },
			{}
		);
		expect(html).toContain("🔥 Ünïcödé ✓</mark>");
	});

	it("uses colors.artifactGrey when no colour is given, and no colour when textColor is absent", () => {
		const html = render({ id: "custom.d", label: "D", text: "x" });
		expect(html).toContain('style="background: #CACFD9A6;"');
		expect(html).not.toContain("color:");
	});

	it("applies textColor as the mark's colour", () => {
		expect(render({ ...SPIKE, textColor: "white" }, { title: "T" })).toContain(
			'style="background: #7E57C2; color: white;"'
		);
	});

	it("puts the order tag on the wrapper", () => {
		for (const tag of ["artifact-item-type", "parent-link", "state", "metadata"]) {
			const html = render({ ...SPIKE, orderTag: tag }, { title: "T" });
			expect(html).toContain(`data-template-key="custom.spike" data-order-tag="${tag}">`);
		}
	});

	it("a dropdown shows its label and keeps the value in data-tpl-value", () => {
		const o = {
			id: "custom.prio",
			label: "Prio",
			fields: [
				{
					name: "level",
					type: "dropdown",
					options: [
						{ label: "High!", value: "high" },
						{ label: "Low", value: "low" },
					],
				},
			],
			text: "Level {{level}}",
		};
		expect(render(o, { level: "high" })).toContain(
			'Level <span data-tpl-var="level" data-tpl-value="high">High!</span>'
		);
		// A plain-string option: label and value are the same text.
		const plain = { ...o, fields: [{ name: "level", type: "dropdown", options: ["A&B"] }] };
		expect(render(plain, { level: "A&B" })).toContain(
			'<span data-tpl-var="level" data-tpl-value="A&amp;B">A&amp;B</span>'
		);
	});

	it("a textarea renders each newline as <br>", () => {
		const o = {
			id: "custom.note",
			label: "Note",
			fields: [{ name: "body", type: "textarea" }],
			text: "{{body}}",
		};
		expect(render(o, { body: "one\ntwo\r\nthree" })).toContain(
			'<span data-tpl-var="body">one<br>two<br>three</span>'
		);
	});

	it("E5: values with < > & \" and {{title}} render escaped and literal, once", () => {
		const nasty = `<b>"x" & y</b> {{title}} {{#timebox}}z{{/timebox}}`;
		const html = render(SPIKE, { title: nasty, timebox: "{{title}}" });
		expect(html).toContain(
			'<span data-tpl-var="title">&lt;b&gt;&quot;x&quot; &amp; y&lt;/b&gt; {{title}} {{#timebox}}z{{/timebox}}</span>'
		);
		// The timebox value is the literal text "{{title}}", never expanded.
		expect(html).toContain('(<span data-tpl-var="timebox">{{title}}</span>)');
		expect(html).not.toContain("<b>");
	});

	it("escapes literal pattern text, the emoji and the label-bearing attributes", () => {
		const html = render(
			{ id: "custom.lit", label: "L", emoji: "<i>", text: "a < b & c" },
			{}
		);
		expect(html).toContain("&lt;i&gt; a &lt; b &amp; c</mark>");
	});

	it("never interpolates a colour into the style unescaped", () => {
		// The validator rejects such colours; the renderer is still safe if one got through.
		const s = spec(SPIKE);
		const html = renderCustomTemplate({ ...s, color: 'red;"><script>' }, { title: "T" });
		expect(html).not.toContain("<script>");
	});

	it("only reads own properties of params (no prototype lookups)", () => {
		const html = render(
			{ id: "custom.p", label: "P", fields: [{ name: "constructor" }], text: "{{constructor}}" },
			{}
		);
		expect(html).toContain('<span data-tpl-var="constructor"></span>');
	});
});

describe("custom template definition", () => {
	const def = buildCustomTemplateDefinition(spec(SPIKE));

	it("has the dialog titles 'Create <label>' / 'Edit <label>' and the field list", () => {
		expect(def.paramsSchema?.titles).toEqual({
			create: "Create Spike",
			edit: "Edit Spike",
		});
		expect(def.paramsSchema?.fields.map((f) => [f.name, f.label, f.type, f.required])).toEqual([
			["title", "Title", "text", true],
			["timebox", "Timebox", "text", false],
		]);
		expect(def.hasParams).toBe(true);
	});

	it("carries the order tag and rules, and no workflows or hidden flag", () => {
		const d = buildCustomTemplateDefinition(
			spec({ ...SPIKE, orderTag: "artifact-item-type", allowedOn: "task", topLevel: true })
		);
		expect(d.orderTag).toBe("artifact-item-type");
		expect(d.rules).toEqual({ allowedOn: ["task"], topLevel: true });
		expect(d.insertWorkflows).toBeUndefined();
		expect(d.hiddenFromDynamicCommands).toBeUndefined();
		expect(d.parseParamsFromDom).toBeUndefined();
	});

	it("a template with no fields has no params dialog", () => {
		const d = buildCustomTemplateDefinition(
			spec({ id: "custom.flag", label: "Flag", emoji: "🚩", text: "Flagged" })
		);
		expect(d.hasParams).toBe(false);
		expect(d.paramsSchema).toBeUndefined();
		expect(normalise(d.render?.() ?? "")).toContain("🚩 Flagged</mark>");
	});

	it("render() is the same as renderCustomTemplate for the spec", () => {
		expect(normalise(def.render?.({ title: "A", timebox: "1d" } as never) ?? "")).toBe(
			render(SPIKE, { title: "A", timebox: "1d" })
		);
	});
});

describe("G19: built-in dropdown fields are unchanged (identical to 5a90994)", () => {
	const byId = new Map<string, TemplateDefinition>();
	for (const defs of Object.values(presetTemplates)) {
		for (const d of Object.values(defs)) byId.set(d.id, d);
	}

	it("CRM commission renders its currency with no data-tpl-value", () => {
		const html = normalise(
			byId.get("crm.commission")?.render?.({
				currency: "€",
				paidAmount: "1,250.00",
				totalAmount: "5,000.00",
			} as never) ?? ""
		);
		// Written out by hand from the 5a90994 golden (tests/fixtures/preset-render.json).
		expect(html).toBe(
			'<span data-template-wrapper="tpl-ID" data-template-key="crm.commission" data-order-tag="crm-commission">' +
				'<mark  style="background: #53BDA5;"><strong>Commission Paid ' +
				'<span data-tpl-var="currency">€</span><span data-tpl-var="paidAmount">1,250.00</span> / ' +
				'<span data-tpl-var="currency">€</span><span data-tpl-var="totalAmount">5,000.00</span>' +
				"</strong></mark></span>"
		);
		expect(html).not.toContain("data-tpl-value");
	});

	it("no built-in output contains data-tpl-value", () => {
		for (const d of byId.values()) {
			const fields = d.paramsSchema?.fields ?? [];
			const params: Record<string, unknown> = {};
			for (const f of fields) {
				params[f.name] = f.options?.[0]?.value ?? "x";
			}
			let html = "";
			try {
				html = d.render?.(params as never) ?? "";
			} catch {
				continue;
			}
			expect(html, d.id).not.toContain("data-tpl-value");
		}
	});
});
