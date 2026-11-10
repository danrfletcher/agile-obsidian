// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App, Plugin } from "obsidian";

// The settings tab only needs a handful of Obsidian classes; these are DOM-backed stand-ins.
vi.mock("obsidian", () => {
	class Setting {
		settingEl = document.createElement("div");
		controlEl = document.createElement("div");
		constructor(parent: HTMLElement) {
			this.settingEl.appendChild(this.controlEl);
			parent.appendChild(this.settingEl);
		}
		setName() {
			return this;
		}
		setDesc() {
			return this;
		}
		setHeading() {
			return this;
		}
		addToggle() {
			return this;
		}
		addButton() {
			return this;
		}
	}
	class PluginSettingTab {
		containerEl = document.createElement("div");
		constructor(
			public app: unknown,
			public plugin: unknown
		) {}
	}
	class Notice {}
	return { Setting, PluginSettingTab, Notice, Plugin: class {}, App: class {} };
});

import { AgileSettingTab } from "../../src/settings/ui/views/settings-view";
import { validateCustomTemplateCard } from "@features/templating-engine/app/custom-templates";
import { buildStarterText } from "@settings/app/custom-templates-settings";
import { VALIDATE_DEBOUNCE_MS } from "@settings/app/custom-templates-controller";
import type { AgileObsidianSettings } from "@settings";

// Obsidian adds these helpers to every element; jsdom does not have them.
interface ElOpts {
	cls?: string;
	text?: string;
	attr?: Record<string, string>;
}
function installObsidianDomHelpers() {
	const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
	proto.createEl = function (this: HTMLElement, tag: string, o: ElOpts = {}) {
		const el = document.createElement(tag);
		if (o.cls) el.className = o.cls;
		if (o.text !== undefined) el.textContent = o.text;
		for (const [k, v] of Object.entries(o.attr ?? {})) el.setAttribute(k, v);
		this.appendChild(el);
		return el;
	};
	proto.createDiv = function (this: HTMLElement, o: ElOpts = {}) {
		return (this as unknown as { createEl: (t: string, o: ElOpts) => HTMLElement }).createEl("div", o);
	};
	proto.empty = function (this: HTMLElement) {
		this.replaceChildren();
	};
	proto.toggleClass = function (this: HTMLElement, cls: string, on: boolean) {
		this.classList.toggle(cls, on);
	};
}

const SPIKE =
	'{"id":"custom.spike","label":"Spike","emoji":"🧪","fields":[{"name":"title","required":true}],"text":"{{title}}"}';
const BAD_SCHEMA = '{"id":"custom.bad","label":"Bad","fields":[{"required":true}],"text":"x"}';
const BAD_JSON = '{"id":"custom.half",';
const BODY =
	'{"id":"custom.big","label":"Big","fields":[{"name":"title","required":true}],"text":"{{title}}"}';
const FIFTY_KB = " \n".repeat(25_000) + BODY;

function setup(initial: string[]) {
	const settings = { customTemplates: [...initial] } as unknown as AgileObsidianSettings;
	const saveSettings = vi.fn(async () => {});
	const rebuild = vi.fn();
	const validate = vi.fn((texts: readonly string[], index: number) => validateCustomTemplateCard(texts, index));
	const tab = new AgileSettingTab(
		{} as App,
		{} as Plugin,
		settings,
		saveSettings,
		{ validate, rebuild }
	);
	const root = tab.containerEl;
	const cards = () => Array.from(root.querySelectorAll<HTMLElement>(".agile-ct-card"));
	const boxes = () => Array.from(root.querySelectorAll<HTMLTextAreaElement>("textarea.agile-ct-box"));
	const statusOf = (i: number) =>
		Array.from(cards()[i].querySelectorAll(".agile-ct-status-line")).map((e) => e.textContent);
	const type = (i: number, text: string) => {
		const box = boxes()[i];
		box.value = text;
		box.dispatchEvent(new Event("input", { bubbles: true }));
	};
	const blur = (i: number) => boxes()[i].dispatchEvent(new Event("blur"));
	const button = (label: string, within: ParentNode = root) =>
		Array.from(within.querySelectorAll("button")).find((b) => b.textContent === label)!;
	return { tab, settings, saveSettings, rebuild, validate, root, cards, boxes, statusOf, type, blur, button };
}

beforeEach(() => {
	installObsidianDomHelpers();
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
});

describe("Custom templates section: drawing the saved cards", () => {
	it("draws one monospace box per saved entry, in order, holding the exact saved text and its status", () => {
		const s = setup([SPIKE, BAD_SCHEMA, BAD_JSON, ""]);
		s.tab.display();
		expect(s.boxes().map((b) => b.value)).toEqual([SPIKE, BAD_SCHEMA, BAD_JSON, ""]);
		expect(s.statusOf(0)).toEqual(["Valid"]);
		expect(s.statusOf(1)).toEqual(validateCustomTemplateCard([SPIKE, BAD_SCHEMA], 1).messages);
		expect(s.statusOf(1).length).toBeGreaterThan(0);
		expect(s.statusOf(1)).not.toContain("Valid");
		expect(s.statusOf(2)).toEqual(validateCustomTemplateCard([BAD_JSON], 0).messages);
		expect(s.statusOf(3)).toEqual(validateCustomTemplateCard([""], 0).messages);
		// Delete on every card, and no other buttons except Add template.
		const labels = Array.from(s.root.querySelectorAll("button")).map((b) => b.textContent);
		expect(labels).toEqual(["Delete", "Delete", "Delete", "Delete", "Add template"]);
	});

	it("shows an empty section with just the Add template button", () => {
		const s = setup([]);
		s.tab.display();
		expect(s.cards()).toHaveLength(0);
		expect(s.button("Add template")).toBeTruthy();
	});
});

describe("Closing and reopening the settings tab (C14)", () => {
	it("reopening draws the same cards, order, text and status", () => {
		const s = setup([SPIKE, BAD_SCHEMA, BAD_JSON]);
		s.tab.display();
		const before = {
			text: s.boxes().map((b) => b.value),
			status: [0, 1, 2].map((i) => s.statusOf(i)),
		};
		s.tab.hide();
		expect(s.cards()).toHaveLength(0);
		s.tab.display();
		expect({
			text: s.boxes().map((b) => b.value),
			status: [0, 1, 2].map((i) => s.statusOf(i)),
		}).toEqual(before);
	});

	it("text typed and blurred before closing is what the reopened tab shows", async () => {
		const s = setup([SPIKE]);
		s.tab.display();
		s.type(0, BAD_JSON);
		s.blur(0);
		await vi.runAllTimersAsync();
		s.tab.hide();
		s.tab.display();
		expect(s.boxes()[0].value).toBe(BAD_JSON);
		expect(s.statusOf(0)).toEqual(validateCustomTemplateCard([BAD_JSON], 0).messages);
	});

	it("closing the tab with text typed but not blurred saves it as typed", async () => {
		const s = setup([SPIKE]);
		s.tab.display();
		s.type(0, BAD_SCHEMA);
		s.tab.hide();
		await vi.runAllTimersAsync();
		expect(s.settings.customTemplates).toEqual([BAD_SCHEMA]);
		expect(s.saveSettings).toHaveBeenCalledTimes(1);
		expect(s.rebuild).toHaveBeenCalledTimes(1);
	});

	it("re-rendering (display again) with text typed but not blurred saves it too", async () => {
		const s = setup([SPIKE]);
		s.tab.display();
		s.type(0, BAD_SCHEMA);
		s.tab.display();
		await vi.runAllTimersAsync();
		expect(s.settings.customTemplates).toEqual([BAD_SCHEMA]);
		expect(s.boxes()[0].value).toBe(BAD_SCHEMA);
	});
});

describe("Plugin disabled or tab closed: nothing left running (C15)", () => {
	it("hide() leaves no timers and no DOM, and a late event from the old box does nothing", async () => {
		const s = setup([SPIKE, BAD_SCHEMA]);
		s.tab.display();
		const oldBox = s.boxes()[0];
		s.type(0, SPIKE + " ");
		s.type(1, BAD_SCHEMA + " ");
		expect(vi.getTimerCount()).toBe(2);
		s.tab.hide();
		await vi.runAllTimersAsync();
		expect(vi.getTimerCount()).toBe(0);
		expect(s.root.childElementCount).toBe(0);
		const validations = s.validate.mock.calls.length;
		// An event from the old, removed box must not start anything.
		oldBox.value = SPIKE + "  ";
		oldBox.dispatchEvent(new Event("input", { bubbles: true }));
		expect(vi.getTimerCount()).toBe(0);
		oldBox.dispatchEvent(new Event("blur"));
		await vi.runAllTimersAsync();
		expect(s.validate.mock.calls.length).toBe(validations);
		expect(s.settings.customTemplates).toEqual([SPIKE + " ", BAD_SCHEMA + " "]);
		// One save per flushed box (two), none from the late events.
		expect(s.saveSettings).toHaveBeenCalledTimes(2);
	});

	it("showing the tab again rebuilds the section from the saved settings", () => {
		const s = setup([SPIKE]);
		s.tab.display();
		s.tab.hide();
		(s.settings as unknown as { customTemplates: string[] }).customTemplates = [BAD_JSON, SPIKE];
		s.tab.display();
		expect(s.boxes().map((b) => b.value)).toEqual([BAD_JSON, SPIKE]);
	});
});

describe("Add, Delete and blur through the real DOM", () => {
	it("Add appends the starter card, saves and rebuilds; Delete removes it again", async () => {
		const s = setup([]);
		s.tab.display();
		s.button("Add template").click();
		await vi.runAllTimersAsync();
		expect(s.settings.customTemplates).toEqual([buildStarterText(1)]);
		expect(s.boxes()[0].value).toBe(buildStarterText(1));
		expect(s.statusOf(0)).toEqual(["Valid"]);
		expect(s.saveSettings).toHaveBeenCalledTimes(1);
		expect(s.rebuild).toHaveBeenCalledTimes(1);
		s.button("Delete", s.cards()[0]).click();
		await vi.runAllTimersAsync();
		expect(s.settings.customTemplates).toEqual([]);
		expect(s.cards()).toHaveLength(0);
		expect(s.rebuild).toHaveBeenCalledTimes(2);
	});

	it("blur saves changed text once and does nothing for unchanged text", async () => {
		const s = setup([SPIKE]);
		s.tab.display();
		s.blur(0);
		await vi.runAllTimersAsync();
		expect(s.saveSettings).not.toHaveBeenCalled();
		s.type(0, BAD_JSON);
		s.blur(0);
		await vi.runAllTimersAsync();
		expect(s.saveSettings).toHaveBeenCalledTimes(1);
		expect(s.rebuild).toHaveBeenCalledTimes(1);
		expect(s.settings.customTemplates).toEqual([BAD_JSON]);
	});
});

describe("A pasted 50 KB definition in the real box (C12)", () => {
	it("is taken in one go, validated once after the debounce, and saved on blur as pasted", async () => {
		const s = setup([SPIKE]);
		s.tab.display();
		const box = s.boxes()[0];
		box.select();
		let inputs = 0;
		box.addEventListener("input", () => inputs++);
		const callsBefore = s.validate.mock.calls.length;
		const ev = new InputEvent("beforeinput", { inputType: "insertFromPaste", data: FIFTY_KB, cancelable: true, bubbles: true });
		const notCancelled = box.dispatchEvent(ev);
		expect(notCancelled).toBe(false); // the browser's own line-by-line insert is cancelled
		expect(inputs).toBe(1);
		expect(box.value).toBe(FIFTY_KB);
		// Nothing is validated on the input path itself.
		expect(s.validate.mock.calls.length).toBe(callsBefore);
		await vi.advanceTimersByTimeAsync(VALIDATE_DEBOUNCE_MS);
		expect(s.validate.mock.calls.length - callsBefore).toBe(1);
		expect(s.statusOf(0)).toEqual(["Valid"]);

		s.blur(0);
		await vi.runAllTimersAsync();
		expect(s.settings.customTemplates).toEqual([FIFTY_KB]);
		expect(s.saveSettings).toHaveBeenCalledTimes(1);
		expect(s.rebuild).toHaveBeenCalledTimes(1);
	});
});
