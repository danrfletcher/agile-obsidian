import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App, Command, Plugin } from "obsidian";
import {
	disposeCustomTemplates,
	reloadCustomTemplates,
	setCustomTemplateSource,
	validateCustomTemplateCard,
} from "@features/templating-engine/app/custom-templates";
import { registerTemplatingDynamicCommands } from "@features/templating-engine/app/dynamic-commands";
import {
	findActiveTemplate,
	setDefaultTemplatesEnabled,
} from "@features/templating-engine/app/template-registry";
import { getSequences } from "@features/templating-sequencer/app/sequencer-service";
import {
	createCustomTemplatesController,
	type CustomTemplatesController,
} from "@settings/app/custom-templates-controller";
import { buildStarterText } from "@settings/app/custom-templates-settings";

const MANIFEST_ID = "agile-templates";

const card = (o: Record<string, unknown>) => JSON.stringify(o);
const SPIKE = card({
	id: "custom.spike",
	label: "Spike",
	emoji: "🧪",
	fields: [{ name: "title", required: true }, { name: "timebox" }],
	text: "{{title}}{{#timebox}} ({{timebox}}){{/timebox}}",
});

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

const customCommandNames = (palette: Map<string, Command>) =>
	Array.from(palette.values())
		.filter((c) => c.id.includes(":tpl:custom."))
		.map((c) => c.name)
		.sort();
const commandId = (templateId: string) => `${MANIFEST_ID}:tpl:${templateId}`;
const pairs = () =>
	getSequences().map((s) => `${s.startTemplate}->${s.targetTemplate}`);

/** The settings view's wiring: the live settings array, the real validator and the real rebuild. */
function wire() {
	const settings = { customTemplates: [] as string[] };
	setCustomTemplateSource(() => settings.customTemplates);
	// What was in settings at the moment each rebuild ran: it must be the saved text.
	const seenAtRebuild: string[][] = [];
	const saveSettings = vi.fn(async () => {});
	const rebuildRegistry = vi.fn(() => {
		seenAtRebuild.push([...settings.customTemplates]);
		reloadCustomTemplates();
	});
	const controller: CustomTemplatesController = createCustomTemplatesController({
		getTexts: () => settings.customTemplates,
		setTexts: (t) => {
			settings.customTemplates = t;
		},
		saveSettings,
		rebuildRegistry,
		validate: validateCustomTemplateCard,
		onStatus: () => {},
		onListChange: () => {},
	});
	return { settings, controller, saveSettings, rebuildRegistry, seenAtRebuild };
}

let cleanups: Array<() => void> = [];

beforeEach(() => {
	setDefaultTemplatesEnabled(true);
	setCustomTemplateSource(() => []);
	reloadCustomTemplates();
});

afterEach(() => {
	for (const c of cleanups) c();
	cleanups = [];
	disposeCustomTemplates();
	setDefaultTemplatesEnabled(true);
});

async function setup() {
	const m = makePlugin();
	cleanups = m.cleanups;
	await registerTemplatingDynamicCommands(stubApp, m.plugin, MANIFEST_ID);
	return { m, w: wire() };
}

describe("Add: the registry and the palette follow, with no reload", () => {
	it("add -> blur: the registry has the id and the command is registered", async () => {
		const { m, w } = await setup();
		expect(findActiveTemplate("custom.template-1")).toBeUndefined();

		await w.controller.add();
		expect(w.settings.customTemplates).toEqual([buildStarterText(1)]);
		expect(findActiveTemplate("custom.template-1")?.label).toBe("New template");
		expect(m.palette.has(commandId("custom.template-1"))).toBe(true);
		expect(customCommandNames(m.palette)).toEqual(["Insert template: New template"]);

		// Clicking out of the untouched starter changes nothing.
		m.addCommand.mockClear();
		await w.controller.blur(0, w.settings.customTemplates[0]);
		expect(w.rebuildRegistry).toHaveBeenCalledTimes(1);
		expect(m.addCommand).not.toHaveBeenCalled();
		expect(m.removeCommand).not.toHaveBeenCalled();
		expect(m.errors).toEqual([]);
	});

	it("add twice on an empty section: both ids loaded, both commands in the palette (E15)", async () => {
		const { m, w } = await setup();
		await w.controller.add();
		await w.controller.add();
		expect(w.settings.customTemplates.map((t) => (JSON.parse(t) as { id: string }).id)).toEqual(
			["custom.template-1", "custom.template-2"]
		);
		expect(findActiveTemplate("custom.template-1")).toBeDefined();
		expect(findActiveTemplate("custom.template-2")).toBeDefined();
		expect(customCommandNames(m.palette)).toEqual([
			"Insert template: New template",
			"Insert template: New template",
		]);
		expect(m.palette.has(commandId("custom.template-1"))).toBe(true);
		expect(m.palette.has(commandId("custom.template-2"))).toBe(true);
		expect(m.errors).toEqual([]);
	});

	it("the rebuild sees the saved text (save first, then rebuild)", async () => {
		const { w } = await setup();
		await w.controller.add();
		await w.controller.blur(0, SPIKE);
		expect(w.seenAtRebuild).toEqual([[buildStarterText(1)], [SPIKE]]);
	});
});

describe("blur: saved as typed, loaded only when valid", () => {
	it("typed valid text replaces the template: the command is renamed, once", async () => {
		const { m, w } = await setup();
		await w.controller.add();
		await w.controller.blur(0, SPIKE);
		expect(findActiveTemplate("custom.template-1")).toBeUndefined();
		expect(findActiveTemplate("custom.spike")?.label).toBe("Spike");
		expect(customCommandNames(m.palette)).toEqual(["Insert template: Spike"]);
		expect(m.removeCommand).toHaveBeenCalledWith(commandId("custom.template-1"));
		expect(m.errors).toEqual([]);
	});

	it("invalid text stays in settings as typed but is not loaded: its command goes", async () => {
		const { m, w } = await setup();
		await w.controller.blur(0, SPIKE).catch(() => {}); // no card 0 yet: ignored
		w.settings.customTemplates = [SPIKE];
		reloadCustomTemplates();
		expect(customCommandNames(m.palette)).toEqual(["Insert template: Spike"]);

		const broken = SPIKE.replace(/,\s*"text".*$/, ",");
		await w.controller.blur(0, broken);
		expect(w.settings.customTemplates).toEqual([broken]);
		expect(findActiveTemplate("custom.spike")).toBeUndefined();
		expect(customCommandNames(m.palette)).toEqual([]);
		expect(m.removeCommand).toHaveBeenCalledWith(commandId("custom.spike"));
	});

	it("blur with unchanged text: no save, no rebuild, no addCommand / removeCommand", async () => {
		const { m, w } = await setup();
		w.settings.customTemplates = [SPIKE, "{"];
		reloadCustomTemplates();
		m.addCommand.mockClear();
		m.removeCommand.mockClear();
		await w.controller.blur(0, SPIKE);
		await w.controller.blur(1, "{");
		expect(w.saveSettings).not.toHaveBeenCalled();
		expect(w.rebuildRegistry).not.toHaveBeenCalled();
		expect(m.addCommand).not.toHaveBeenCalled();
		expect(m.removeCommand).not.toHaveBeenCalled();
	});

	it("a later card with a duplicate id is not loaded; the earlier card stays loaded (E1)", async () => {
		const { m, w } = await setup();
		w.settings.customTemplates = [SPIKE, card({ id: "custom.second", label: "Second", text: "x" })];
		reloadCustomTemplates();
		await w.controller.blur(1, SPIKE.replace('"Spike"', '"Spike again"'));
		expect(findActiveTemplate("custom.spike")?.label).toBe("Spike");
		expect(customCommandNames(m.palette)).toEqual(["Insert template: Spike"]);
		expect(w.controller.status(1)).toEqual({
			valid: false,
			lines: ['id: "custom.spike" is already used by another template'],
		});
		expect(w.controller.status(0)).toEqual({ valid: true, lines: ["Valid"] });
	});

	it("auto sequences follow: two cards with the same fields move into each other, and stop when one is gone", async () => {
		const { w } = await setup();
		const research = card({
			id: "custom.research",
			label: "Research",
			fields: [{ name: "title", required: true }, { name: "timebox" }],
			text: "{{title}}{{#timebox}} ({{timebox}}){{/timebox}}",
		});
		expect(validateCustomTemplateCard([research], 0).ok).toBe(true);
		w.settings.customTemplates = [SPIKE];
		reloadCustomTemplates();
		expect(pairs()).not.toContain("custom.spike->custom.research");

		await w.controller.blur(0, SPIKE); // unchanged: nothing
		w.settings.customTemplates = [SPIKE, ""];
		await w.controller.blur(1, research);
		expect(pairs()).toContain("custom.spike->custom.research");
		expect(pairs()).toContain("custom.research->custom.spike");

		await w.controller.remove(1);
		expect(pairs()).not.toContain("custom.spike->custom.research");
		expect(pairs()).not.toContain("custom.research->custom.spike");
	});
});

describe("Delete: the command goes through Plugin.removeCommand; the rest survive", () => {
	it("removes only that card's command and leaves the other cards' commands registered", async () => {
		const { m, w } = await setup();
		await w.controller.add(); // template-1
		await w.controller.add(); // template-2
		await w.controller.add(); // template-3
		const registeredBefore = new Set(m.palette.keys());
		m.addCommand.mockClear();
		m.removeCommand.mockClear();

		await w.controller.remove(1); // custom.template-2

		expect(m.removeCommand).toHaveBeenCalledTimes(1);
		expect(m.removeCommand).toHaveBeenCalledWith(commandId("custom.template-2"));
		expect(m.addCommand).not.toHaveBeenCalled(); // no churn on the survivors
		expect(m.palette.has(commandId("custom.template-1"))).toBe(true);
		expect(m.palette.has(commandId("custom.template-3"))).toBe(true);
		expect(m.palette.has(commandId("custom.template-2"))).toBe(false);
		expect(findActiveTemplate("custom.template-2")).toBeUndefined();
		expect(findActiveTemplate("custom.template-1")).toBeDefined();
		expect(findActiveTemplate("custom.template-3")).toBeDefined();
		// every other command, built-in or custom, is still the same registration
		for (const id of registeredBefore) {
			if (id !== commandId("custom.template-2")) expect(m.palette.has(id)).toBe(true);
		}
		expect(w.settings.customTemplates.map((t) => (JSON.parse(t) as { id: string }).id)).toEqual(
			["custom.template-1", "custom.template-3"]
		);
		expect(m.errors).toEqual([]);
	});

	it("deleting an invalid card removes nothing from the palette", async () => {
		const { m, w } = await setup();
		w.settings.customTemplates = [SPIKE, '{"id":'];
		reloadCustomTemplates();
		m.removeCommand.mockClear();
		await w.controller.remove(1);
		expect(m.removeCommand).not.toHaveBeenCalled();
		expect(customCommandNames(m.palette)).toEqual(["Insert template: Spike"]);
		expect(w.settings.customTemplates).toEqual([SPIKE]);
	});

	it("deleting the last card leaves no custom command and the built-ins untouched", async () => {
		const { m, w } = await setup();
		const builtIn = Array.from(m.palette.keys()).filter((k) => !k.includes(":tpl:custom."));
		await w.controller.add();
		await w.controller.remove(0);
		expect(w.settings.customTemplates).toEqual([]);
		expect(customCommandNames(m.palette)).toEqual([]);
		expect(Array.from(m.palette.keys()).filter((k) => !k.includes(":tpl:custom."))).toEqual(
			builtIn
		);
		expect(builtIn).toHaveLength(44);
	});
});
