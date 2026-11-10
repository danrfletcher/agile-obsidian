import { describe, expect, it } from "vitest";
import { presetTemplates } from "@features/templating-engine/domain/presets";
import { findTemplateById } from "@features/templating-engine/app/templating-service";
import fixture from "../fixtures/presets.json";

type Def = {
	id: string;
	label: string;
	orderTag?: string;
	hasParams?: boolean;
	rules?: unknown;
	insertWorkflows?: unknown;
	hiddenFromDynamicCommands?: boolean;
	paramsSchema?: unknown;
};

function categoryOf(id: string): string {
	if (id.startsWith("agile.personal")) return "Agile (Personal)";
	if (id.startsWith("agile.")) return "Agile";
	if (id.startsWith("crm.")) return "CRM";
	if (id.startsWith("prio.kano.")) return "Kano";
	if (id.startsWith("prio.moscow.")) return "MoSCoW";
	if (id.startsWith("prio.nalap.")) return "NALAp";
	if (id.startsWith("workflows.")) return "Workflow";
	if (id.startsWith("obsidian.")) return "Obsidian";
	return "??";
}

const current: Def[] = [];
for (const defs of Object.values(presetTemplates)) {
	for (const def of Object.values(defs as Record<string, Def>)) {
		current.push(def);
	}
}

// Projection identical to the one used to capture the fixture at 5a90994.
// JSON round-trip drops functions, as it did for the capture.
const project = (def: Def) =>
	JSON.parse(
		JSON.stringify({
			id: def.id,
			label: def.label,
			orderTag: def.orderTag ?? null,
			hasParams: def.hasParams ?? false,
			rules: def.rules ?? null,
			insertWorkflows: def.insertWorkflows ?? null,
			hiddenFromDynamicCommands: def.hiddenFromDynamicCommands ?? false,
			paramsSchema: def.paramsSchema ?? null,
		})
	) as Record<string, unknown>;

describe("built-in presets vs agile-obsidian 5a90994", () => {
	it("has exactly 44 built-ins, in the G1 categories, and no members.*", () => {
		expect(current).toHaveLength(44);
		const counts: Record<string, number> = {};
		for (const d of current) {
			const c = categoryOf(d.id);
			counts[c] = (counts[c] ?? 0) + 1;
		}
		expect(counts).toEqual({
			Agile: 9,
			"Agile (Personal)": 2,
			CRM: 7,
			Kano: 5,
			MoSCoW: 4,
			NALAp: 6,
			Workflow: 8,
			Obsidian: 3,
		});
		expect(current.filter((d) => d.id.startsWith("members."))).toEqual([]);
		expect(Object.keys(presetTemplates)).not.toContain("members");
		expect(new Set(current.map((d) => d.id)).size).toBe(44);
	});

	it("the fixture itself records 44 templates and the removed Members preset", () => {
		expect(fixture.templates).toHaveLength(44);
		expect(fixture.removed).toEqual([
			{
				id: "members.assignee",
				label: "Members - Assignee",
				orderTag: "assignment",
			},
		]);
	});

	it("members.assignee is no longer a built-in", () => {
		expect(findTemplateById("members.assignee")).toBeUndefined();
	});

	it("has the same ids, in the same order, as 5a90994 (minus members.assignee)", () => {
		expect(current.map((d) => d.id)).toEqual(
			fixture.templates.map((t) => t.id)
		);
	});

	it("every built-in has an 'Insert template' label", () => {
		for (const d of current) {
			expect(typeof d.label).toBe("string");
			expect(d.label.length).toBeGreaterThan(0);
		}
	});

	describe.each(fixture.templates.map((t) => [t.id, t] as const))(
		"%s",
		(id, expected) => {
			it("keeps the 5a90994 orderTag and rules", () => {
				const def = current.find((d) => d.id === id);
				expect(def).toBeDefined();
				expect(def!.orderTag ?? null).toBe(expected.orderTag);
				expect(JSON.parse(JSON.stringify(def!.rules ?? null))).toEqual(
					expected.rules
				);
			});

			it("keeps the 5a90994 label, params schema and workflows", () => {
				const def = current.find((d) => d.id === id);
				expect(project(def!)).toEqual({
					id: expected.id,
					label: expected.label,
					orderTag: expected.orderTag,
					hasParams: expected.hasParams,
					rules: expected.rules,
					insertWorkflows: expected.insertWorkflows,
					hiddenFromDynamicCommands: expected.hiddenFromDynamicCommands,
					paramsSchema: expected.paramsSchema,
				});
			});
		}
	);
});
