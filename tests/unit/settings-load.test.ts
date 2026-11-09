import { describe, expect, it, vi } from "vitest";
import { loadSettings } from "../../src/settings/app/settings-load";
import { DEFAULT_SETTINGS } from "../../src/settings/infra/settings-store";
import { initSettings } from "../../src/composition/register-settings";

const KEPT_KEYS = [
	"enableCanonicalOnLeafChange",
	"enableCanonicalOnLineCommit",
	"enableDefaultTemplates",
	"enableTaskCanonicalFormatter",
	"enableUxRepeatAgileTemplates",
	"uiFoldAgileTaskFormatting",
	"uiFoldUxShortcuts",
];

describe("settings load (E9)", () => {
	it("DEFAULT_SETTINGS has only the kept keys", () => {
		expect(Object.keys(DEFAULT_SETTINGS).sort()).toEqual(KEPT_KEYS);
	});

	it("'Double-Enter repeats template' defaults to on", () => {
		expect(DEFAULT_SETTINGS.enableUxRepeatAgileTemplates).toBe(true);
	});

	it("keeps known keys with valid values", () => {
		const r = loadSettings({
			enableDefaultTemplates: false,
			enableUxRepeatAgileTemplates: false,
			enableTaskCanonicalFormatter: false,
			enableCanonicalOnLineCommit: false,
			enableCanonicalOnLeafChange: false,
			uiFoldUxShortcuts: false,
			uiFoldAgileTaskFormatting: false,
		});
		expect(r.settings).toEqual({
			enableDefaultTemplates: false,
			enableUxRepeatAgileTemplates: false,
			enableTaskCanonicalFormatter: false,
			enableCanonicalOnLineCommit: false,
			enableCanonicalOnLeafChange: false,
			uiFoldUxShortcuts: false,
			uiFoldAgileTaskFormatting: false,
		});
		expect(r.needsSave).toBe(false);
	});

	it("drops unknown and old keys and flags needsSave", () => {
		const r = loadSettings({
			enableUxRepeatAgileTemplates: false,
			teams: [{ name: "x" }],
			showEpics: false,
			enableMetadataCleanup: true,
			useBundledCheckboxes: true,
			somethingElse: 1,
		});
		expect(Object.keys(r.settings).sort()).toEqual(KEPT_KEYS);
		for (const k of [
			"teams",
			"showEpics",
			"enableMetadataCleanup",
			"useBundledCheckboxes",
			"somethingElse",
		]) {
			expect(r.settings).not.toHaveProperty(k);
		}
		expect(r.settings.enableUxRepeatAgileTemplates).toBe(false);
		expect(r.needsSave).toBe(true);
	});

	it("defaults missing keys without asking for a save", () => {
		const r = loadSettings({ enableCanonicalOnLineCommit: false });
		expect(r.settings).toEqual({
			...DEFAULT_SETTINGS,
			enableCanonicalOnLineCommit: false,
		});
		expect(r.needsSave).toBe(false);
	});

	it("uses the default when a kept key has the wrong type", () => {
		const r = loadSettings({
			enableUxRepeatAgileTemplates: "yes",
			enableTaskCanonicalFormatter: 1,
			enableCanonicalOnLineCommit: null,
			enableCanonicalOnLeafChange: {},
			uiFoldUxShortcuts: "false",
			uiFoldAgileTaskFormatting: [],
		});
		expect(r.settings).toEqual(DEFAULT_SETTINGS);
	});

	it.each([null, undefined, "x", 5, true, [], [1, 2]])(
		"treats stored data %j as empty",
		(stored) => {
			const r = loadSettings(stored);
			expect(r.settings).toEqual(DEFAULT_SETTINGS);
			expect(r.needsSave).toBe(false);
		}
	);

	it("returns a fresh object and does not mutate the stored data", () => {
		const stored = { teams: [], enableUxRepeatAgileTemplates: false };
		const copy = JSON.parse(JSON.stringify(stored)) as typeof stored;
		const r = loadSettings(stored);
		expect(stored).toEqual(copy);
		expect(r.settings).not.toBe(DEFAULT_SETTINGS);
		r.settings.uiFoldUxShortcuts = false;
		expect(DEFAULT_SETTINGS.uiFoldUxShortcuts).toBe(true);
	});
});

describe("initSettings (first load saves once, second load does not)", () => {
	it("saves the cleaned settings once when keys were dropped", async () => {
		let disk: unknown = {
			teams: [],
			showEpics: true,
			enableMetadataCleanup: true,
			useBundledCheckboxes: true,
			enableUxRepeatAgileTemplates: false,
		};
		const saveData = vi.fn((d: unknown) => {
			disk = JSON.parse(JSON.stringify(d));
			return Promise.resolve();
		});
		const makePlugin = () =>
			({
				loadData: () => Promise.resolve(disk),
				saveData,
			}) as unknown as Parameters<typeof initSettings>[0];

		const first = await initSettings(makePlugin());
		expect(saveData).toHaveBeenCalledTimes(1);
		expect(Object.keys(disk as object).sort()).toEqual(KEPT_KEYS);
		expect(first.enableUxRepeatAgileTemplates).toBe(false);

		await initSettings(makePlugin());
		expect(saveData).toHaveBeenCalledTimes(1);
	});

	it("does not save when nothing was dropped (including no data.json)", async () => {
		const saveData = vi.fn(() => Promise.resolve());
		const plugin = {
			loadData: () => Promise.resolve(null),
			saveData,
		} as unknown as Parameters<typeof initSettings>[0];
		const s = await initSettings(plugin);
		expect(s).toEqual(DEFAULT_SETTINGS);
		expect(saveData).not.toHaveBeenCalled();
	});
});
