import { describe, expect, it, vi } from "vitest";
import { presetTemplates } from "@features/templating-engine/domain/presets";
import type { TemplateDefinition } from "@features/templating-engine/domain/types";
import {
	createTemplateRegistry,
	templateRegistry,
	findActiveTemplate,
	findAnyTemplate,
	listActiveTemplates,
	setDefaultTemplatesEnabled,
	setCustomDefinitions,
} from "@features/templating-engine/app/template-registry";
import { findTemplateById } from "@features/templating-engine/app/templating-service";

const builtInIds: string[] = [];
for (const defs of Object.values(presetTemplates)) {
	for (const def of Object.values(defs)) {
		builtInIds.push(def.id);
	}
}

// A plain fixture definition (not PR-5's JSON parser).
const customSpike: TemplateDefinition = {
	id: "custom.spike",
	label: "Spike",
	hasParams: true,
	paramsSchema: {
		fields: [{ name: "title", required: true }, { name: "timebox" }],
	} as TemplateDefinition["paramsSchema"],
	render: () => "<span>spike</span>",
};

describe("template registry: the built-in list", () => {
	it("has the 44 built-ins", () => {
		expect(builtInIds).toHaveLength(44);
		expect(createTemplateRegistry().listBuiltInTemplates()).toHaveLength(44);
	});
});

describe("template registry: list and find with the flag", () => {
	for (const id of builtInIds) {
		it(`${id}: resolves when on, undefined when off`, () => {
			const reg = createTemplateRegistry();
			expect(reg.findActiveTemplate(id)?.id).toBe(id);
			reg.setDefaultTemplatesEnabled(false);
			expect(reg.findActiveTemplate(id)).toBeUndefined();
			// still known for label fallbacks
			expect(reg.findAnyTemplate(id)?.id).toBe(id);
			reg.setDefaultTemplatesEnabled(true);
			expect(reg.findActiveTemplate(id)?.id).toBe(id);
		});
	}

	it("a fixture custom definition resolves in both states", () => {
		const reg = createTemplateRegistry();
		reg.setCustomDefinitions([customSpike]);
		expect(reg.findActiveTemplate("custom.spike")).toBe(customSpike);
		reg.setDefaultTemplatesEnabled(false);
		expect(reg.findActiveTemplate("custom.spike")).toBe(customSpike);
	});

	it("lists 44 + custom when on and custom only when off", () => {
		const reg = createTemplateRegistry();
		expect(reg.listActiveTemplates()).toHaveLength(44);
		reg.setCustomDefinitions([customSpike]);
		expect(reg.listActiveTemplates()).toHaveLength(45);
		expect(reg.listActiveTemplates().map((d) => d.id)).toContain("custom.spike");
		reg.setDefaultTemplatesEnabled(false);
		expect(reg.listActiveTemplates()).toEqual([customSpike]);
		reg.setCustomDefinitions([]);
		expect(reg.listActiveTemplates()).toEqual([]);
	});

	it("keeps the multi-dot / last-segment resolution of the old lookup", () => {
		const reg = createTemplateRegistry();
		const ids = builtInIds.filter((id) => id.split(".").length > 2);
		expect(ids.length).toBeGreaterThan(0);
		for (const id of ids) expect(reg.findActiveTemplate(id)?.id).toBe(id);
	});

	it("unknown ids (e.g. the removed members.assignee) never resolve, on or off", () => {
		const reg = createTemplateRegistry();
		for (const on of [true, false]) {
			reg.setDefaultTemplatesEnabled(on);
			expect(reg.findActiveTemplate("members.assignee")).toBeUndefined();
			expect(reg.findAnyTemplate("members.assignee")).toBeUndefined();
			expect(reg.findActiveTemplate("")).toBeUndefined();
			expect(reg.findActiveTemplate("custom.nope")).toBeUndefined();
		}
	});
});

describe("template registry: onChange", () => {
	it("fires once per real change and not on a no-op set", () => {
		const reg = createTemplateRegistry();
		const fn = vi.fn();
		reg.onChange(fn);
		const v0 = reg.getVersion();

		reg.setDefaultTemplatesEnabled(true); // already on
		expect(fn).toHaveBeenCalledTimes(0);
		expect(reg.getVersion()).toBe(v0);

		reg.setDefaultTemplatesEnabled(false);
		expect(fn).toHaveBeenCalledTimes(1);
		reg.setDefaultTemplatesEnabled(false); // no-op
		expect(fn).toHaveBeenCalledTimes(1);

		reg.setCustomDefinitions([customSpike]);
		expect(fn).toHaveBeenCalledTimes(2);
		reg.setCustomDefinitions([customSpike]); // same definitions: no-op
		expect(fn).toHaveBeenCalledTimes(2);
		reg.setCustomDefinitions([]);
		expect(fn).toHaveBeenCalledTimes(3);
		reg.setCustomDefinitions([]); // no-op
		expect(fn).toHaveBeenCalledTimes(3);

		expect(reg.getVersion()).toBe(v0 + 3);
	});

	it("unsubscribe stops notifications, and a throwing listener does not block others", () => {
		const reg = createTemplateRegistry();
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		const a = vi.fn(() => {
			throw new Error("boom");
		});
		const b = vi.fn();
		reg.onChange(a);
		const offB = reg.onChange(b);
		reg.setDefaultTemplatesEnabled(false);
		expect(a).toHaveBeenCalledTimes(1);
		expect(b).toHaveBeenCalledTimes(1);
		offB();
		reg.setDefaultTemplatesEnabled(true);
		expect(b).toHaveBeenCalledTimes(1);
		err.mockRestore();
	});

	it("instances are independent of each other", () => {
		const a = createTemplateRegistry();
		const b = createTemplateRegistry();
		a.setDefaultTemplatesEnabled(false);
		expect(b.isDefaultTemplatesEnabled()).toBe(true);
	});
});

describe("the plugin-wide registry feeds findTemplateById", () => {
	it("follows the flag live, with no captured state", () => {
		try {
			expect(findTemplateById("agile.epic")?.id).toBe("agile.epic");
			setDefaultTemplatesEnabled(false);
			expect(findTemplateById("agile.epic")).toBeUndefined();
			expect(findActiveTemplate("agile.epic")).toBeUndefined();
			expect(findAnyTemplate("agile.epic")?.id).toBe("agile.epic");
			expect(listActiveTemplates()).toHaveLength(0);
			setCustomDefinitions([customSpike]);
			expect(findTemplateById("custom.spike")).toBe(customSpike);
			setDefaultTemplatesEnabled(true);
			expect(findTemplateById("agile.epic")?.id).toBe("agile.epic");
		} finally {
			setCustomDefinitions([]);
			setDefaultTemplatesEnabled(true);
		}
		expect(templateRegistry.isDefaultTemplatesEnabled()).toBe(true);
	});
});
