import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createDefaultSettings,
	loadStoredSettings,
	type AgileObsidianSettings,
} from "@settings";
import { DEFAULT_SETTINGS } from "../../src/settings/infra/settings-store";
import {
	initSettings,
	registerSettings,
} from "../../src/composition/register-settings";
import type { Container } from "../../src/composition/container";
import {
	isDefaultTemplatesEnabled,
	setDefaultTemplatesEnabled,
} from "@features/templating-engine/app/template-registry";

afterEach(() => setDefaultTemplatesEnabled(true));

describe("enableDefaultTemplates default and persistence", () => {
	it("defaults to true", () => {
		expect(DEFAULT_SETTINGS.enableDefaultTemplates).toBe(true);
		expect(createDefaultSettings().enableDefaultTemplates).toBe(true);
	});

	it("a fresh install (no data.json) loads it as on", () => {
		for (const stored of [undefined, null, {}]) {
			const { settings } = loadStoredSettings(stored);
			expect(settings.enableDefaultTemplates).toBe(true);
		}
	});

	it("a data.json without the key loads it as on, without needing a re-save", () => {
		const { settings, needsSave } = loadStoredSettings({
			enableUxRepeatAgileTemplates: false,
			enableTaskCanonicalFormatter: false,
		});
		expect(settings.enableDefaultTemplates).toBe(true);
		expect(settings.enableUxRepeatAgileTemplates).toBe(false);
		expect(needsSave).toBe(false);
	});

	it("a wrongly typed value falls back to on", () => {
		expect(
			loadStoredSettings({ enableDefaultTemplates: "no" }).settings
				.enableDefaultTemplates
		).toBe(true);
	});

	it("survives a save/load round-trip, off and on", () => {
		for (const value of [false, true]) {
			const saved = JSON.stringify({
				...createDefaultSettings(),
				enableDefaultTemplates: value,
			});
			const { settings, needsSave } = loadStoredSettings(JSON.parse(saved));
			expect(settings.enableDefaultTemplates).toBe(value);
			expect(needsSave).toBe(false);
		}
	});
});

describe("the flag reaches the live registry through the real composition code", () => {
	type FakePlugin = {
		settings: AgileObsidianSettings;
		loadData: () => Promise<unknown>;
		saveData: ReturnType<typeof vi.fn>;
	};

	it("initSettings seeds the registry from stored data (off survives a restart)", async () => {
		const plugin: FakePlugin = {
			settings: undefined as unknown as AgileObsidianSettings,
			loadData: async () => ({ enableDefaultTemplates: false }),
			saveData: vi.fn(async () => {}),
		};
		await initSettings(plugin as never);
		expect(plugin.settings.enableDefaultTemplates).toBe(false);
		expect(isDefaultTemplatesEnabled()).toBe(false);

		plugin.loadData = async () => undefined; // fresh install
		await initSettings(plugin as never);
		expect(plugin.settings.enableDefaultTemplates).toBe(true);
		expect(isDefaultTemplatesEnabled()).toBe(true);
	});

	it("saving settings after the toggle updates the registry: save first, then registry", async () => {
		const order: string[] = [];
		const settings = { ...createDefaultSettings() };
		let tab: { saveSettings: () => Promise<void> } | undefined;
		const plugin = {
			settings,
			saveSettings: vi.fn(async () => {
				order.push(
					`save(registry still ${isDefaultTemplatesEnabled() ? "on" : "off"})`
				);
			}),
			addSettingTab: vi.fn((t: { saveSettings: () => Promise<void> }) => {
				tab = t;
			}),
		};
		const container = {
			app: { workspace: { trigger: vi.fn() } },
			plugin,
			get settings() {
				return plugin.settings;
			},
		} as unknown as Container;

		await registerSettings(container);
		expect(tab).toBeDefined();

		// What the toggle's onChange does: mutate the live settings, then save.
		settings.enableDefaultTemplates = false;
		await tab!.saveSettings();
		expect(order).toEqual(["save(registry still on)"]);
		expect(isDefaultTemplatesEnabled()).toBe(false);

		settings.enableDefaultTemplates = true;
		await tab!.saveSettings();
		expect(isDefaultTemplatesEnabled()).toBe(true);
	});
});
