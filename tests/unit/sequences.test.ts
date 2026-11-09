import { afterEach, describe, expect, it } from "vitest";
import {
	buildSequences,
	generateDynamicSequences,
	manualSequences,
	type AnyTemplateDef,
} from "@features/templating-sequencer/domain/preset-sequences";
import {
	buildSequenceIndex,
	computeAvailableMoves,
	getSequenceIndex,
	getSequences,
	isSequenceEligibleTemplate,
} from "@features/templating-sequencer/app/sequencer-service";
import {
	createTemplateRegistry,
	setCustomDefinitions,
	setDefaultTemplatesEnabled,
} from "@features/templating-engine/app/template-registry";
import { presetTemplates } from "@features/templating-engine/domain/presets";
import type { TemplateDefinition } from "@features/templating-engine/domain/types";
import fixture from "../fixtures/preset-sequences.json";

const builtIns: TemplateDefinition[] = [];
for (const defs of Object.values(presetTemplates)) {
	for (const def of Object.values(defs)) {
		builtIns.push(def);
	}
}
const builtInIds = new Set(builtIns.map((d) => d.id));

const epic = builtIns.find((d) => d.id === "agile.epic") as TemplateDefinition;

// Plain fixture definitions (not PR-5's JSON parser).
// Same field-name set as agile.epic.
const customLikeEpic: TemplateDefinition = {
	id: "custom.epic-lite",
	label: "Epic lite",
	hasParams: true,
	paramsSchema: epic.paramsSchema,
};
// Same set as each other, but unlike any built-in.
const customSpike: TemplateDefinition = {
	id: "custom.spike",
	hasParams: true,
	paramsSchema: {
		fields: [{ name: "title" }, { name: "timebox" }],
	} as TemplateDefinition["paramsSchema"],
};
const customResearch: TemplateDefinition = {
	id: "custom.research",
	hasParams: true,
	paramsSchema: {
		fields: [{ name: "timebox" }, { name: "title" }, { name: "title" }],
	} as TemplateDefinition["paramsSchema"],
};

const pair = (s: { startTemplate: string; targetTemplate: string }) =>
	`${s.startTemplate}->${s.targetTemplate}`;

/** Independent restatement of the rule, used to check the generator. */
function expectedAutoPairs(defs: readonly TemplateDefinition[]): string[] {
	const names = (d: TemplateDefinition) =>
		Array.from(
			new Set(
				(d.paramsSchema?.fields ?? [])
					.map((f) => String(f?.name ?? "").trim())
					.filter(Boolean)
			)
		).sort();
	const eligible = defs.filter(
		(d) => !d.hiddenFromDynamicCommands && d.hasParams === true && names(d).length > 0
	);
	const out: string[] = [];
	for (const a of eligible) {
		for (const b of eligible) {
			if (a.id === b.id) continue;
			if (names(a).join("|") === names(b).join("|")) out.push(`${a.id}->${b.id}`);
		}
	}
	return out;
}

afterEach(() => {
	setCustomDefinitions([]);
	setDefaultTemplatesEnabled(true);
});

describe("sequence generation from a template list", () => {
	it("auto pairs equal the ordered pairs with identical sorted, deduped field-name sets", () => {
		const list = [...builtIns, customLikeEpic, customSpike, customResearch];
		const auto = generateDynamicSequences(list as AnyTemplateDef[]);
		expect(auto.map(pair).sort()).toEqual(expectedAutoPairs(list).sort());
		expect(auto.every((s) => s.direction === "forwards")).toBe(true);
		expect(auto.every((s) => s.id === `auto:${pair(s)}`)).toBe(true);
	});

	it("the on-state list equals the agile-obsidian 5a90994 presetSequences, in order (E7 guard)", () => {
		// Functions (variableMapOverrides) are dropped by JSON, exactly as in the capture.
		const current = JSON.parse(
			JSON.stringify(buildSequences(builtIns as AnyTemplateDef[]))
		) as unknown;
		expect(current).toEqual(fixture.sequences);
		expect((current as unknown[]).length).toBeGreaterThan(0);
	});

	it("the live on-state list (via the registry) equals the 5a90994 list too", () => {
		expect(JSON.parse(JSON.stringify(getSequences()))).toEqual(fixture.sequences);
	});

	it("off state: no sequence has a built-in endpoint", () => {
		const reg = createTemplateRegistry();
		reg.setDefaultTemplatesEnabled(false);
		expect(buildSequences(reg.listActiveTemplates() as AnyTemplateDef[])).toEqual([]);

		reg.setCustomDefinitions([customSpike, customResearch]);
		const seqs = buildSequences(reg.listActiveTemplates() as AnyTemplateDef[]);
		expect(seqs.length).toBe(2);
		for (const s of seqs) {
			expect(builtInIds.has(s.startTemplate)).toBe(false);
			expect(builtInIds.has(s.targetTemplate)).toBe(false);
		}
	});

	it("a manual sequence is dropped when either end is missing, and kept when both are present", () => {
		const crmPair = manualSequences.find(
			(m) => m.id === "crm:awaiting->depositPaid"
		);
		expect(crmPair).toBeDefined();
		const onlyStart = builtIns.filter((d) => d.id !== "crm.depositPaid");
		const onlyTarget = builtIns.filter((d) => d.id !== "crm.awaitingDeposit");
		for (const list of [onlyStart, onlyTarget]) {
			const ids = buildSequences(list as AnyTemplateDef[]).map((s) => s.id);
			expect(ids).not.toContain("crm:awaiting->depositPaid");
		}
		expect(
			buildSequences(builtIns as AnyTemplateDef[]).map((s) => s.id)
		).toContain("crm:awaiting->depositPaid");
	});

	it("E8: a custom def with agile.epic's field set gets Epic as a target when on, never when off", () => {
		const on = createTemplateRegistry();
		on.setCustomDefinitions([customLikeEpic]);
		const onPairs = buildSequences(on.listActiveTemplates() as AnyTemplateDef[]).map(pair);
		expect(onPairs).toContain("custom.epic-lite->agile.epic");
		expect(onPairs).toContain("agile.epic->custom.epic-lite");

		on.setDefaultTemplatesEnabled(false);
		const offSeqs = buildSequences(on.listActiveTemplates() as AnyTemplateDef[]);
		expect(offSeqs).toEqual([]);
		expect(offSeqs.some((s) => s.targetTemplate === "agile.epic")).toBe(false);
	});
});

describe("live sequences, index and eligible set follow the registry", () => {
	it("rebuild on every registry change, with no reload", () => {
		expect(isSequenceEligibleTemplate("agile.epic")).toBe(true);
		const fwdOn = computeAvailableMoves("agile.epic", {}).forward.map((s) => s.targetTemplate);
		expect(fwdOn.length).toBeGreaterThan(0);

		setDefaultTemplatesEnabled(false);
		expect(isSequenceEligibleTemplate("agile.epic")).toBe(false);
		expect(isSequenceEligibleTemplate("crm.depositPaid")).toBe(false);
		expect(getSequences()).toEqual([]);
		expect(getSequenceIndex().byStart.size).toBe(0);
		expect(computeAvailableMoves("agile.epic", {})).toEqual({ forward: [], backward: [] });

		setCustomDefinitions([customLikeEpic]);
		expect(isSequenceEligibleTemplate("agile.epic")).toBe(false);
		expect(isSequenceEligibleTemplate("custom.epic-lite")).toBe(false); // nothing to move to

		setDefaultTemplatesEnabled(true);
		expect(isSequenceEligibleTemplate("agile.epic")).toBe(true);
		expect(isSequenceEligibleTemplate("custom.epic-lite")).toBe(true);
		expect(
			computeAvailableMoves("agile.epic", {}).forward.map((s) => s.targetTemplate)
		).toContain("custom.epic-lite");

		setCustomDefinitions([]);
		expect(getSequences().map(pair)).not.toContain("agile.epic->custom.epic-lite");
	});

	it("manual CRM moves are dropped off and restored on", () => {
		const has = () => getSequences().some((s) => s.id === "crm:awaiting->depositPaid");
		expect(has()).toBe(true);
		setDefaultTemplatesEnabled(false);
		expect(has()).toBe(false);
		setDefaultTemplatesEnabled(true);
		expect(has()).toBe(true);
	});

	it("unknown keys (old members.assignee) are never eligible, on or off", () => {
		for (const on of [true, false]) {
			setDefaultTemplatesEnabled(on);
			expect(isSequenceEligibleTemplate("members.assignee")).toBe(false);
			expect(computeAvailableMoves("members.assignee", {})).toEqual({
				forward: [],
				backward: [],
			});
		}
	});

	it("buildSequenceIndex indexes reversible targets only for direction both", () => {
		const idx = buildSequenceIndex(buildSequences(builtIns as AnyTemplateDef[]));
		expect(idx.reversibleByTarget.get("crm.depositPaid")?.length).toBeGreaterThan(0);
		expect(idx.reversibleByTarget.get("agile.epic")).toBeUndefined();
	});
});
