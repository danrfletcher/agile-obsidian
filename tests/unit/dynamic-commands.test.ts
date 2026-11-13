import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App, Command, Plugin } from "obsidian";
import { registerTemplatingDynamicCommands } from "@features/templating-engine/app/dynamic-commands";
import {
	setCustomDefinitions,
	setDefaultTemplatesEnabled,
} from "@features/templating-engine/app/template-registry";
import { presetTemplates } from "@features/templating-engine/domain/presets";
import type { TemplateDefinition } from "@features/templating-engine/domain/types";

const MANIFEST_ID = "agile-templates";

const builtIns: TemplateDefinition[] = [];
for (const defs of Object.values(presetTemplates)) {
	for (const def of Object.values(defs)) {
		builtIns.push(def);
	}
}

const customSpike: TemplateDefinition = {
	id: "custom.spike",
	label: "Spike",
	hasParams: false,
	render: () => "<span>spike</span>",
};

/**
 * Mock Plugin: spies on addCommand/removeCommand, plus a tiny palette model that, like
 * Obsidian, rejects a duplicate add ("Command already exists") and a remove of an id that
 * was never added (a silent no-op in the real thing, which would leave a leftover).
 */
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
	workspace: {
		getActiveViewOfType: () => null,
		on: vi.fn(() => ({})),
	},
} as unknown as App;

const removedIds = (calls: unknown[][]) => calls.map((c) => c[0] as string);
const addedIds = (calls: unknown[][]) => calls.map((c) => (c[0] as Command).id);

let cleanups: Array<() => void> = [];

async function setup() {
	const m = makePlugin();
	cleanups = m.cleanups;
	await registerTemplatingDynamicCommands(stubApp, m.plugin, MANIFEST_ID);
	return m;
}

beforeEach(() => {
	setCustomDefinitions([]);
	setDefaultTemplatesEnabled(true);
});

afterEach(() => {
	for (const c of cleanups) c();
	cleanups = [];
	setCustomDefinitions([]);
	setDefaultTemplatesEnabled(true);
});

describe("dynamic commands follow the registry", () => {
	it("registers one command per built-in (44) with 'Insert template: <label>'", async () => {
		const m = await setup();
		expect(builtIns.filter((d) => !d.hiddenFromDynamicCommands)).toHaveLength(44);
		expect(m.addCommand).toHaveBeenCalledTimes(44);
		expect(m.removeCommand).not.toHaveBeenCalled();
		const epic = Array.from(m.palette.values()).find(
			(c) => c.id === `${MANIFEST_ID}:tpl:agile.epic`
		);
		expect(epic?.name).toBe("Insert template: Agile - Epic");
		for (const cmd of m.palette.values()) {
			expect(cmd.id.startsWith(`${MANIFEST_ID}:tpl:`)).toBe(true);
			expect(cmd.name.startsWith("Insert template: ")).toBe(true);
		}
	});

	it("off removes exactly the 44 ids, and the id passed to removeCommand equals the one passed to addCommand", async () => {
		const m = await setup();
		const added = addedIds(m.addCommand.mock.calls as unknown[][]);
		// The palette holds exactly what addCommand received (ids the same, unprefixed form).
		expect(Array.from(m.palette.keys()).sort()).toEqual([...added].sort());

		setDefaultTemplatesEnabled(false);

		const removed = removedIds(m.removeCommand.mock.calls as unknown[][]);
		expect(removed).toHaveLength(44);
		expect(new Set(removed).size).toBe(44);
		expect([...removed].sort()).toEqual([...added].sort());
		expect(m.palette.size).toBe(0);
		expect(m.errors).toEqual([]);
		expect(m.addCommand).toHaveBeenCalledTimes(44); // nothing re-added
	});

	it("on re-adds the same 44 ids", async () => {
		const m = await setup();
		const firstIds = addedIds(m.addCommand.mock.calls as unknown[][]);
		setDefaultTemplatesEnabled(false);
		m.addCommand.mockClear();
		setDefaultTemplatesEnabled(true);
		const readded = addedIds(m.addCommand.mock.calls as unknown[][]);
		expect([...readded].sort()).toEqual([...firstIds].sort());
		expect(m.palette.size).toBe(44);
		expect(m.errors).toEqual([]);
	});

	it("a no-op toggle neither adds nor removes", async () => {
		const m = await setup();
		m.addCommand.mockClear();
		setDefaultTemplatesEnabled(true);
		expect(m.addCommand).not.toHaveBeenCalled();
		expect(m.removeCommand).not.toHaveBeenCalled();
	});

	it("repeated toggles never add a live id twice and match the final state", async () => {
		const m = await setup();
		for (let i = 0; i < 5; i++) {
			setDefaultTemplatesEnabled(false);
			setDefaultTemplatesEnabled(true);
		}
		setDefaultTemplatesEnabled(false);
		expect(m.errors).toEqual([]);
		expect(m.palette.size).toBe(0);

		setDefaultTemplatesEnabled(true);
		expect(m.errors).toEqual([]);
		expect(m.palette.size).toBe(44);
		// every id is added once more than it was removed (alive), never two adds in a row
		const adds = addedIds(m.addCommand.mock.calls as unknown[][]);
		const removes = removedIds(m.removeCommand.mock.calls as unknown[][]);
		for (const id of new Set(adds)) {
			const a = adds.filter((x) => x === id).length;
			const r = removes.filter((x) => x === id).length;
			expect(a - r).toBe(1);
		}
	});

	it("custom definitions get a command added after a toggle, and are removed with the set of customs", async () => {
		const m = await setup();
		setDefaultTemplatesEnabled(false);
		expect(m.palette.size).toBe(0);

		setCustomDefinitions([customSpike]);
		expect(Array.from(m.palette.keys())).toEqual([`${MANIFEST_ID}:tpl:custom.spike`]);
		expect(Array.from(m.palette.values())[0].name).toBe("Insert template: Spike");

		setDefaultTemplatesEnabled(true);
		expect(m.palette.size).toBe(45);

		setCustomDefinitions([]);
		expect(m.palette.size).toBe(44);
		expect(m.palette.has(`${MANIFEST_ID}:tpl:custom.spike`)).toBe(false);
		expect(m.errors).toEqual([]);
	});

	it("a changed label re-registers the command under the same id", async () => {
		const m = await setup();
		setCustomDefinitions([customSpike]);
		const renamed: TemplateDefinition = { ...customSpike, label: "Spike 2" };
		setCustomDefinitions([renamed]);
		const cmd = m.palette.get(`${MANIFEST_ID}:tpl:custom.spike`);
		expect(cmd?.name).toBe("Insert template: Spike 2");
		expect(m.errors).toEqual([]);
	});

	it("a command invoked while its template is inactive does nothing (and checking is false)", async () => {
		const m = await setup();
		const cmd = m.palette.get(`${MANIFEST_ID}:tpl:agile.epic`) as Command;
		setDefaultTemplatesEnabled(false);
		// the command object was removed from the palette; calling a stale reference is a no-op
		expect(cmd.checkCallback?.(true)).toBe(false);
		expect(cmd.checkCallback?.(false)).toBe(false);
	});

	it("unload cleanup unsubscribes: later registry changes touch no command", async () => {
		const m = await setup();
		for (const c of m.cleanups) c();
		m.addCommand.mockClear();
		m.removeCommand.mockClear();
		setDefaultTemplatesEnabled(false);
		expect(m.removeCommand).not.toHaveBeenCalled();
		expect(m.addCommand).not.toHaveBeenCalled();
	});
});
