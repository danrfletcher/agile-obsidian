import { describe, expect, it } from "vitest";
import { presetSequences } from "@features/templating-sequencer/domain/preset-sequences";
import { presetTemplates } from "@features/templating-engine/domain/presets";
import fixture from "../fixtures/preset-sequences.json";

// Functions (variableMapOverrides) are dropped by JSON, exactly as in the capture.
const current = JSON.parse(JSON.stringify(presetSequences)) as Array<{
	startTemplate: string;
	targetTemplate: string;
	direction: string;
}>;

describe("preset sequences vs agile-obsidian 5a90994", () => {
	it("has the same move list, in the same order", () => {
		expect(current).toEqual(fixture.sequences);
		expect(current.length).toBeGreaterThan(0);
	});

	it("no move targets or starts at members.assignee", () => {
		for (const s of presetSequences) {
			expect(s.startTemplate).not.toBe("members.assignee");
			expect(s.targetTemplate).not.toBe("members.assignee");
		}
	});

	it("every move references a built-in that still exists", () => {
		const ids = new Set<string>();
		for (const defs of Object.values(presetTemplates)) {
			for (const d of Object.values(defs)) ids.add(d.id);
		}
		for (const s of presetSequences) {
			expect(ids.has(s.startTemplate)).toBe(true);
			expect(ids.has(s.targetTemplate)).toBe(true);
		}
	});
});
