import { describe, expect, it } from "vitest";
import { presetTemplates } from "@features/templating-engine/domain/presets";
import fixture from "../fixtures/preset-render.json";

type Def = {
	id: string;
	render: (params?: Record<string, unknown>) => string;
};

const byId = new Map<string, Def>();
for (const defs of Object.values(presetTemplates)) {
	for (const def of Object.values(defs as Record<string, Def>)) {
		byId.set(def.id, def);
	}
}

// Wrapper instance ids are random per render; the golden normalised them the same way.
const normalise = (html: string) =>
	html.replace(
		/data-template-wrapper="tpl-[a-z0-9]+"/g,
		'data-template-wrapper="tpl-ID"'
	);

describe("preset render goldens captured at 5a90994", () => {
	it("covers every built-in, and no members.assignee", () => {
		const ids = new Set(fixture.cases.map((c) => c.id));
		expect([...ids].sort()).toEqual([...byId.keys()].sort());
		expect(ids.has("members.assignee")).toBe(false);
	});

	it.each(fixture.cases.map((c) => [`${c.id} / ${c.case}`, c] as const))(
		"%s renders identical HTML",
		(_name, c) => {
			const def = byId.get(c.id);
			expect(def).toBeDefined();
			const params = (c.params ?? undefined) as
				| Record<string, unknown>
				| undefined;
			expect(normalise(def!.render(params))).toBe(c.html);
		}
	);

	it("keeps wrapper attributes, tpl-var spans and the order tag in the goldens", () => {
		// Guards the fixture itself: the goldens must actually carry what G1/G3/E7 rely on.
		const epic = fixture.cases.find(
			(c) => c.id === "agile.epic" && c.case === "full"
		);
		expect(epic?.html).toContain('data-template-key="agile.epic"');
		expect(epic?.html).toContain('data-order-tag="artifact-item-type"');
		expect(epic?.html).toContain("data-tpl-var=");
	});
});
