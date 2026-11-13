import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App, Command, Plugin } from "obsidian";
import {
	disposeCustomTemplates,
	getOtherTemplateIdsForCard,
	loadCustomTemplates,
	reloadCustomTemplates,
	setCustomTemplateSource,
} from "@features/templating-engine/app/custom-templates";
import { registerTemplatingDynamicCommands } from "@features/templating-engine/app/dynamic-commands";
import {
	findActiveTemplate,
	getRegistryVersion,
	listActiveTemplates,
	setDefaultTemplatesEnabled,
} from "@features/templating-engine/app/template-registry";
import { listBuiltInTemplateIds } from "@features/templating-engine/domain/built-in-ids";
import { validateCustomTemplateText } from "@features/templating-engine/domain/custom-template-schema";
import { getAgileArtifactType } from "@features/templating-engine/domain/artifact-type";
import { buildSequences } from "@features/templating-sequencer/domain/preset-sequences";
import {
	computeAvailableMoves,
	getSequenceIndex,
	getSequences,
	isSequenceEligibleTemplate,
} from "@features/templating-sequencer/app/sequencer-service";

const MANIFEST_ID = "agile-templates";
const BUILT_IN_IDS = listBuiltInTemplateIds();

const card = (o: Record<string, unknown>) => JSON.stringify(o);

const SPIKE = card({
	id: "custom.spike",
	label: "Spike",
	emoji: "🧪",
	color: "#7E57C2",
	fields: [{ name: "title", required: true }, { name: "timebox" }],
	text: "{{title}}{{#timebox}} ({{timebox}}){{/timebox}}",
});
const RESEARCH = card({
	id: "custom.research",
	label: "Research",
	emoji: "🔎",
	fields: [{ name: "title", required: true }, { name: "timebox" }],
	text: "{{title}}{{#timebox}} ({{timebox}}){{/timebox}}",
});
// Same field names as agile.epic (title, details), checked below.
const NOTE = card({
	id: "custom.note",
	label: "Note",
	fields: [{ name: "details", type: "textarea" }, { name: "title" }],
	text: "{{title}}: {{details}}",
});
const FLAG = card({ id: "custom.flag", label: "Flag", emoji: "🚩", text: "Flagged" });

let cards: string[] = [];
setCustomTemplateSource(() => cards);

const ids = () => listActiveTemplates().map((d) => d.id);
const customIds = () => ids().filter((i) => i.startsWith("custom."));
const pairs = () =>
	getSequences().map((s) => `${s.startTemplate}->${s.targetTemplate}`);

beforeEach(() => {
	cards = [];
	setCustomTemplateSource(() => cards);
	setDefaultTemplatesEnabled(true);
	reloadCustomTemplates();
});

afterEach(() => {
	disposeCustomTemplates();
	setDefaultTemplatesEnabled(true);
});

describe("loading customTemplates (string[]) into the live registry", () => {
	it("loads valid cards in card order, after the built-ins", () => {
		cards = [RESEARCH, SPIKE];
		reloadCustomTemplates();
		expect(customIds()).toEqual(["custom.research", "custom.spike"]);
		expect(ids().slice(0, BUILT_IN_IDS.length)).toEqual(BUILT_IN_IDS);
		expect(findActiveTemplate("custom.spike")?.label).toBe("Spike");
	});

	it("skips invalid entries and still loads the valid ones", () => {
		cards = ['{"id": "custom.bad",', SPIKE, card({ id: "nope", label: "x", text: "x" })];
		const load = reloadCustomTemplates();
		expect(customIds()).toEqual(["custom.spike"]);
		expect(load.cards.map((c) => [c.index, c.loaded])).toEqual([
			[0, false],
			[1, true],
			[2, false],
		]);
		expect(load.cards[2].errors).toEqual(['id: must start with "custom."']);
	});

	it("an empty list and an empty-string card load nothing and throw nothing", () => {
		expect(() => reloadCustomTemplates()).not.toThrow();
		expect(customIds()).toEqual([]);
		cards = ["", "   "];
		const load = reloadCustomTemplates();
		expect(customIds()).toEqual([]);
		expect(load.cards.every((c) => !c.loaded && c.errors.length === 0)).toBe(true);
	});

	it("is not confused by a source that is not an array", () => {
		setCustomTemplateSource(() => undefined as unknown as string[]);
		expect(() => reloadCustomTemplates()).not.toThrow();
		expect(customIds()).toEqual([]);
	});

	it("a card that is not a string is reported and skipped", () => {
		cards = [5 as unknown as string, SPIKE];
		const load = reloadCustomTemplates();
		expect(load.cards[0]).toEqual({ index: 0, loaded: false, errors: ["not a string"] });
		expect(customIds()).toEqual(["custom.spike"]);
	});

	it("removing a card removes its template on the next reload", () => {
		cards = [SPIKE, RESEARCH];
		reloadCustomTemplates();
		cards = [SPIKE];
		reloadCustomTemplates();
		expect(customIds()).toEqual(["custom.spike"]);
		expect(findActiveTemplate("custom.research")).toBeUndefined();
	});

	it("unloading the plugin removes every custom template", () => {
		cards = [SPIKE];
		reloadCustomTemplates();
		disposeCustomTemplates();
		expect(customIds()).toEqual([]);
	});
});

describe("E1: id collisions give an error on the later card and it is not loaded", () => {
	it("a built-in id fails the prefix rule", () => {
		const res = validateCustomTemplateText(
			card({ id: "agile.epic", label: "Epic", text: "x" }),
			BUILT_IN_IDS
		);
		expect(res.messages).toContain('id: must start with "custom."');
	});

	it("a future custom.* built-in id is caught by the check against the registry ids", () => {
		const load = loadCustomTemplates([SPIKE], [...BUILT_IN_IDS, "custom.spike"]);
		expect(load.definitions).toEqual([]);
		expect(load.cards[0].errors).toEqual([
			'id: "custom.spike" is already used by another template',
		]);
	});

	it("a repeated custom id: the first card loads, the later one is the error", () => {
		const second = card({ id: "custom.spike", label: "Spike again", text: "x" });
		cards = [SPIKE, second];
		const load = reloadCustomTemplates();
		expect(customIds()).toEqual(["custom.spike"]);
		expect(findActiveTemplate("custom.spike")?.label).toBe("Spike");
		expect(load.cards[0].loaded).toBe(true);
		expect(load.cards[1]).toMatchObject({
			loaded: false,
			errors: ['id: "custom.spike" is already used by another template'],
		});
	});

	it("live feedback for card N uses the ids the loader would have taken", () => {
		const second = card({ id: "custom.spike", label: "Spike again", text: "x" });
		const taken = getOtherTemplateIdsForCard([SPIKE, second], 1);
		expect(taken).toEqual([...BUILT_IN_IDS, "custom.spike"]);
		expect(validateCustomTemplateText(second, taken).ok).toBe(false);
		// Card 0 is not blamed for a later card's id.
		expect(
			validateCustomTemplateText(SPIKE, getOtherTemplateIdsForCard([SPIKE, second], 0)).ok
		).toBe(true);
		// An invalid earlier card does not reserve its id.
		const bad = card({ id: "custom.spike", label: 1, text: "x" });
		expect(getOtherTemplateIdsForCard([bad, SPIKE], 1)).toEqual(BUILT_IN_IDS);
	});
});

describe("auto sequences from custom templates, through the real preset-sequences merge", () => {
	it("E3: two custom templates with the same field set sequence both ways", () => {
		cards = [SPIKE, RESEARCH];
		reloadCustomTemplates();
		expect(pairs()).toContain("custom.spike->custom.research");
		expect(pairs()).toContain("custom.research->custom.spike");
		const ids2 = getSequences().map((s) => s.id);
		expect(ids2).toContain("auto:custom.spike->custom.research");
		expect(ids2).toContain("auto:custom.research->custom.spike");
	});

	it("E3: field order and required-ness do not matter for the match", () => {
		const reversed = card({
			id: "custom.rev",
			label: "Rev",
			fields: [{ name: "timebox", required: true }, { name: "title" }],
			text: "{{title}} {{timebox}}",
		});
		cards = [SPIKE, reversed];
		reloadCustomTemplates();
		expect(pairs()).toContain("custom.spike->custom.rev");
		expect(pairs()).toContain("custom.rev->custom.spike");
	});

	it("a different field set gets no sequence", () => {
		cards = [SPIKE, NOTE.replace("details", "other")];
		reloadCustomTemplates();
		expect(pairs().filter((p) => p.includes("custom."))).toEqual([]);
	});

	it("a template with no fields is not part of any sequence", () => {
		cards = [FLAG, SPIKE];
		reloadCustomTemplates();
		expect(pairs().filter((p) => p.includes("custom.flag"))).toEqual([]);
		expect(isSequenceEligibleTemplate("custom.flag")).toBe(false);
	});

	it("E4: fields title+details sequence both ways with agile.epic while Default is on", () => {
		cards = [NOTE];
		reloadCustomTemplates();
		expect(pairs()).toContain("agile.epic->custom.note");
		expect(pairs()).toContain("custom.note->agile.epic");
		expect(computeAvailableMoves("agile.epic", {}).forward.map((s) => s.targetTemplate)).toContain(
			"custom.note"
		);
		expect(
			computeAvailableMoves("custom.note", {}).forward.map((s) => s.targetTemplate)
		).toContain("agile.epic");
	});

	it("E8: with Default off, only custom targets are offered", () => {
		cards = [NOTE, card({
			id: "custom.memo",
			label: "Memo",
			fields: [{ name: "title" }, { name: "details" }],
			text: "{{title}} {{details}}",
		})];
		reloadCustomTemplates();
		setDefaultTemplatesEnabled(false);

		const moves = computeAvailableMoves("custom.note", {});
		expect(moves.forward.map((s) => s.targetTemplate)).toEqual(["custom.memo"]);
		for (const s of [...moves.forward, ...moves.backward]) {
			expect(BUILT_IN_IDS).not.toContain(s.startTemplate);
			expect(BUILT_IN_IDS).not.toContain(s.targetTemplate);
		}
		for (const s of getSequences()) {
			expect(BUILT_IN_IDS).not.toContain(s.startTemplate);
			expect(BUILT_IN_IDS).not.toContain(s.targetTemplate);
		}
		expect(Array.from(getSequenceIndex().byStart.keys()).sort()).toEqual([
			"custom.memo",
			"custom.note",
		]);

		setDefaultTemplatesEnabled(true);
		expect(
			computeAvailableMoves("custom.note", {}).forward.map((s) => s.targetTemplate)
		).toContain("agile.epic");
	});

	it("reload rebuilds the sequences, the index and the eligible set", () => {
		expect(isSequenceEligibleTemplate("custom.spike")).toBe(false);
		cards = [SPIKE, RESEARCH];
		reloadCustomTemplates();
		expect(isSequenceEligibleTemplate("custom.spike")).toBe(true);
		expect(getSequenceIndex().byStart.get("custom.spike")?.map((s) => s.targetTemplate)).toEqual([
			"custom.research",
		]);

		cards = [SPIKE];
		reloadCustomTemplates();
		expect(isSequenceEligibleTemplate("custom.spike")).toBe(false);
		expect(getSequenceIndex().byStart.has("custom.spike")).toBe(false);
		expect(pairs().filter((p) => p.includes("custom."))).toEqual([]);
	});

	it("matches buildSequences over the active list (nothing is added on the side)", () => {
		cards = [SPIKE, RESEARCH, NOTE];
		reloadCustomTemplates();
		expect(getSequences()).toEqual(buildSequences(listActiveTemplates()));
	});

	it("a custom template has no manual sequence and no insert workflows (F4/F6)", () => {
		cards = [SPIKE, RESEARCH];
		reloadCustomTemplates();
		for (const s of getSequences().filter((s) => s.startTemplate.startsWith("custom."))) {
			expect(s.id.startsWith("auto:")).toBe(true);
		}
		for (const d of listActiveTemplates().filter((d) => d.id.startsWith("custom."))) {
			expect(d.insertWorkflows).toBeUndefined();
		}
	});
});

describe("reloadCustomTemplates() twice is the same as once", () => {
	it("an unchanged reload does not touch the registry", () => {
		cards = [SPIKE, RESEARCH];
		reloadCustomTemplates();
		const version = getRegistryVersion();
		const spike = findActiveTemplate("custom.spike");
		const before = JSON.stringify(pairs());
		reloadCustomTemplates();
		reloadCustomTemplates();
		expect(getRegistryVersion()).toBe(version);
		expect(findActiveTemplate("custom.spike")).toBe(spike);
		expect(JSON.stringify(pairs())).toBe(before);
		expect(pairs().filter((p) => p === "custom.spike->custom.research")).toHaveLength(1);
	});

	it("a changed definition is replaced", () => {
		cards = [SPIKE];
		reloadCustomTemplates();
		const before = findActiveTemplate("custom.spike");
		cards = [SPIKE.replace('"Spike"', '"Spike v2"')];
		reloadCustomTemplates();
		expect(findActiveTemplate("custom.spike")).not.toBe(before);
		expect(findActiveTemplate("custom.spike")?.label).toBe("Spike v2");
	});
});

describe("E13: custom ids never get an artefact type from their key", () => {
	const chip = (key: string) =>
		`<span data-template-wrapper="tpl-x" data-template-key="${key}" data-order-tag="artifact-item-type"><mark>x</mark></span>`;
	const task = (text: string) =>
		({ text, status: "O" }) as unknown as Parameters<typeof getAgileArtifactType>[0];

	it.each(["custom.epic-lite", "custom.story", "custom.okr-x", "custom.initiative"])(
		"%s",
		(key) => {
			expect(getAgileArtifactType(task(`${chip(key)} a`))).toBeNull();
		}
	);

	it("also holds when the custom template is loaded and active", () => {
		cards = [
			card({ id: "custom.epic-lite", label: "Epic lite", orderTag: "artifact-item-type", text: "e" }),
		];
		reloadCustomTemplates();
		expect(findActiveTemplate("custom.epic-lite")).toBeDefined();
		expect(getAgileArtifactType(task(`${chip("custom.epic-lite")} a`))).toBeNull();
	});

	it("built-in ids still resolve by key", () => {
		expect(getAgileArtifactType(task(`${chip("agile.epic")} a`))).toBe("epic");
		expect(getAgileArtifactType(task(`${chip("agile.userStory")} a`))).toBe("story");
		expect(getAgileArtifactType(task(`${chip("agile.initiative")} a`))).toBe("initiative");
		expect(getAgileArtifactType(task(`${chip("agile.okr")} a`))).toBe("okr");
	});
});

// ---- commands, with a Plugin stub that records addCommand / removeCommand ----

function makePlugin() {
	const palette = new Map<string, Command>();
	const errors: string[] = [];
	const cleanups: Array<() => void> = [];
	const addCommand = vi.fn((cmd: Command) => {
		if (palette.has(cmd.id)) errors.push(`Command already exists: ${cmd.id}`);
		palette.set(cmd.id, cmd);
		return cmd;
	});
	const removeCommand = vi.fn((id: string) => {
		if (!palette.has(id)) errors.push(`Remove of unknown command: ${id}`);
		palette.delete(id);
	});
	const plugin = {
		addCommand,
		removeCommand,
		registerEvent: vi.fn(),
		register: vi.fn((cb: () => void) => {
			cleanups.push(cb);
		}),
	} as unknown as Plugin;
	return { plugin, palette, errors, addCommand, removeCommand, cleanups };
}

const stubApp = {
	workspace: { getActiveViewOfType: () => null, on: vi.fn(() => ({})) },
} as unknown as App;

const customNames = (palette: Map<string, Command>) =>
	Array.from(palette.values())
		.filter((c) => c.id.includes(":tpl:custom."))
		.map((c) => c.name)
		.sort();

describe("insert commands follow reloadCustomTemplates() (no plugin reload)", () => {
	let cleanups: Array<() => void> = [];
	afterEach(() => {
		for (const c of cleanups) c();
		cleanups = [];
	});
	async function setup() {
		const m = makePlugin();
		cleanups = m.cleanups;
		await registerTemplatingDynamicCommands(stubApp, m.plugin, MANIFEST_ID);
		return m;
	}

	it("adds 'Insert template: <label>' for each valid card, none for an invalid one", async () => {
		const m = await setup();
		expect(customNames(m.palette)).toEqual([]);

		cards = [SPIKE, '{"id": "custom.bad"', RESEARCH];
		reloadCustomTemplates();
		expect(customNames(m.palette)).toEqual([
			"Insert template: Research",
			"Insert template: Spike",
		]);
		expect(m.palette.has(`${MANIFEST_ID}:tpl:custom.spike`)).toBe(true);
		expect(m.palette.has(`${MANIFEST_ID}:tpl:custom.bad`)).toBe(false);
		expect(m.errors).toEqual([]);
	});

	it("a template with no fields still gets its command", async () => {
		const m = await setup();
		cards = [FLAG];
		reloadCustomTemplates();
		expect(customNames(m.palette)).toEqual(["Insert template: Flag"]);
		expect(findActiveTemplate("custom.flag")?.hasParams).toBe(false);
	});

	it("calling it twice quickly leaves no duplicate commands", async () => {
		const m = await setup();
		cards = [SPIKE, RESEARCH];
		reloadCustomTemplates();
		const adds = m.addCommand.mock.calls.length;
		reloadCustomTemplates();
		reloadCustomTemplates();
		expect(m.addCommand.mock.calls.length).toBe(adds);
		expect(m.removeCommand).not.toHaveBeenCalled();
		expect(m.errors).toEqual([]);
		expect(customNames(m.palette)).toHaveLength(2);
	});

	it("a label change renames the command: remove the old, add the new, once", async () => {
		const m = await setup();
		cards = [SPIKE];
		reloadCustomTemplates();
		m.addCommand.mockClear();
		cards = [SPIKE.replace('"Spike"', '"Probe"')];
		reloadCustomTemplates();
		expect(customNames(m.palette)).toEqual(["Insert template: Probe"]);
		expect(m.removeCommand).toHaveBeenCalledWith(`${MANIFEST_ID}:tpl:custom.spike`);
		expect(m.addCommand).toHaveBeenCalledTimes(1);
		expect(m.errors).toEqual([]);
	});

	it("removing a card removes its command", async () => {
		const m = await setup();
		cards = [SPIKE, RESEARCH];
		reloadCustomTemplates();
		cards = [SPIKE];
		reloadCustomTemplates();
		expect(customNames(m.palette)).toEqual(["Insert template: Spike"]);
		expect(m.removeCommand).toHaveBeenCalledWith(`${MANIFEST_ID}:tpl:custom.research`);
	});

	it("disabling the plugin removes the custom commands", async () => {
		const m = await setup();
		cards = [SPIKE, RESEARCH];
		reloadCustomTemplates();
		expect(customNames(m.palette)).toHaveLength(2);
		// What Plugin.onunload does, before Obsidian runs the plugin's registered cleanups.
		disposeCustomTemplates();
		expect(customNames(m.palette)).toEqual([]);
		for (const c of cleanups) c();
		expect(m.errors).toEqual([]);
	});

	it("the built-in commands are untouched by a reload", async () => {
		const m = await setup();
		const builtIn = Array.from(m.palette.keys()).filter((k) => !k.includes(":tpl:custom."));
		expect(builtIn.length).toBe(44);
		cards = [SPIKE];
		reloadCustomTemplates();
		cards = [];
		reloadCustomTemplates();
		expect(Array.from(m.palette.keys()).filter((k) => !k.includes(":tpl:custom."))).toEqual(
			builtIn
		);
	});
});
