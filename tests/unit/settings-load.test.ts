import { describe, expect, it, vi } from "vitest";
import { loadSettings } from "../../src/settings/app/settings-load";
import { DEFAULT_SETTINGS } from "../../src/settings/infra/settings-store";
import { initSettings } from "../../src/composition/register-settings";

const KEPT_KEYS = [
	"customTemplates",
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
			customTemplates: ['{"id":"custom.a"}'],
		});
		expect(r.settings).toEqual({
			enableDefaultTemplates: false,
			enableUxRepeatAgileTemplates: false,
			enableTaskCanonicalFormatter: false,
			enableCanonicalOnLineCommit: false,
			enableCanonicalOnLeafChange: false,
			uiFoldUxShortcuts: false,
			uiFoldAgileTaskFormatting: false,
			customTemplates: ['{"id":"custom.a"}'],
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

describe("customTemplates setting (raw JSON text per card, in card order)", () => {
	it("defaults to an empty list, and each load gets its own array", () => {
		expect(DEFAULT_SETTINGS.customTemplates).toEqual([]);
		const a = loadSettings({}).settings;
		a.customTemplates.push("{}");
		expect(DEFAULT_SETTINGS.customTemplates).toEqual([]);
		expect(loadSettings({}).settings.customTemplates).toEqual([]);
	});

	it("keeps the stored texts as written and in order, valid or not", () => {
		const cards = ['{"id":"custom.a"', "", '{"id":"custom.b"}'];
		const r = loadSettings({ customTemplates: cards });
		expect(r.settings.customTemplates).toEqual(cards);
		expect(r.settings.customTemplates).not.toBe(cards);
		expect(r.needsSave).toBe(false);
	});

	it("drops non-string entries and falls back to [] for a wrong type", () => {
		expect(
			loadSettings({ customTemplates: ["a", 1, null, {}, "b"] }).settings
				.customTemplates
		).toEqual(["a", "b"]);
		for (const bad of ["x", 5, {}, null, true]) {
			expect(
				loadSettings({ customTemplates: bad }).settings.customTemplates
			).toEqual([]);
		}
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
