// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { openMenu, showSchema, showJson } = vi.hoisted(() => ({
	openMenu: vi.fn(),
	showSchema: vi.fn(),
	showJson: vi.fn(async () => undefined),
}));

vi.mock("@features/templating-sequencer/ui/menu", () => ({
	openSequencerMenuAt: openMenu,
}));
// Keep the real params-editor, but the modal is answered by the test, not by a real dialog.
vi.mock("@features/templating-params-editor", async (orig) => ({
	...(await orig<Record<string, unknown>>()),
	showSchemaModal: showSchema,
	showJsonModal: showJson,
}));

import { TFile } from "obsidian";
import type { App } from "obsidian";
import { extractParamsFromWrapperEl } from "@features/templating-engine/domain/template-parameter-helpers";
import {
	findTemplateById,
	prefillTemplateParams,
	renderTemplateOnly,
} from "@features/templating-engine/app/templating-service";
import {
	disposeCustomTemplates,
	reloadCustomTemplates,
	setCustomTemplateSource,
} from "@features/templating-engine/app/custom-templates";
import { setDefaultTemplatesEnabled } from "@features/templating-engine/app/template-registry";
import { editTemplateParamsOnDashboard } from "@features/templating-params-editor/app/edit-template-params";
import { attachEditorTemplatingHandler } from "@features/templating-params-editor/ui/handlers/editor-click-handler";
import type { AppDeps } from "@features/templating-params-editor/app/ports";
import { wireTemplatingUxShortcutsDomHandlers } from "@features/templating-ux-shortcuts";
import {
	computeAvailableMoves,
	executeSequenceMoveOnFile,
} from "@features/templating-sequencer/app/sequencer-service";

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
	color: "#26A69A",
	fields: [{ name: "title", required: true }, { name: "timebox" }],
	text: "{{title}}{{#timebox}} ({{timebox}}){{/timebox}}",
});
const PRIO = card({
	id: "custom.prio",
	label: "Prio",
	fields: [
		{
			name: "level",
			type: "dropdown",
			options: [
				{ label: "High!", value: "high" },
				{ label: "Low", value: "low" },
			],
		},
	],
	text: "Level {{level}}",
});
const NOTE = card({
	id: "custom.note",
	label: "Note",
	fields: [{ name: "body", type: "textarea" }],
	text: "{{body}}",
});

let cards: string[] = [];
const FILE = "Scratch/spike.md";

beforeEach(() => {
	cards = [];
	setCustomTemplateSource(() => cards);
	setDefaultTemplatesEnabled(true);
	reloadCustomTemplates();
	vi.clearAllMocks();
});
afterEach(() => {
	document.body.innerHTML = "";
	disposeCustomTemplates();
	setDefaultTemplatesEnabled(true);
});

const setCards = (...c: string[]) => {
	cards = c;
	reloadCustomTemplates();
};

const render = (id: string, params: Record<string, unknown>) => renderTemplateOnly(id, params);

function mount(html: string): { root: HTMLElement; chip: HTMLElement } {
	const root = document.createElement("div");
	root.append(document.createRange().createContextualFragment(html));
	document.body.appendChild(root);
	return { root, chip: root.querySelector("span[data-template-wrapper]") as HTMLElement };
}

const instanceOf = (html: string) =>
	/data-template-wrapper="([^"]+)"/.exec(html)?.[1] as string;

/** The edit flow with the real registry lookup, prefill and render; only the dialog is scripted. */
async function edit(
	chipHtml: string,
	answer: (schema: { fields: Array<{ name: string; defaultValue?: unknown }> }) => Record<string, unknown> | undefined
) {
	const line = `- [ ] ${chipHtml}`;
	let content = line;
	const { chip } = mount(chipHtml);
	const writeFile = vi.fn(async (_p: string, c: string) => {
		content = c;
	});
	showSchema.mockImplementationOnce(async (...args: unknown[]) =>
		answer(args[1] as Parameters<typeof answer>[0])
	);
	const deps: AppDeps = {
		templating: {
			findTemplateById: (id) => {
				const d = findTemplateById(id);
				return d
					? {
							id: d.id,
							hasParams: !!d.hasParams,
							hiddenFromDynamicCommands: d.hiddenFromDynamicCommands,
							paramsSchema: d.paramsSchema,
					  }
					: undefined;
			},
			prefillTemplateParams: (id, el) => prefillTemplateParams(id, el),
			renderTemplateOnly: async (id, params) => render(id, params),
			showSchemaModal: showSchema,
			showJsonModal: showJson,
		},
		vault: { readFile: async () => content, writeFile },
		refresh: { refreshForFile: async () => {} },
		notices: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
	};
	await editTemplateParamsOnDashboard(
		{
			wrapperEl: chip,
			templateKey: chip.getAttribute("data-template-key") as string,
			instanceId: chip.getAttribute("data-template-wrapper") ?? undefined,
		},
		{ filePath: FILE, lineHint0: 0 },
		deps
	);
	return { content, deps, writeFile };
}

describe("extraction from a rendered chip", () => {
	it("reads values by field name from [data-tpl-var]", () => {
		setCards(SPIKE);
		const { chip } = mount(render("custom.spike", { title: "Auth options", timebox: "2d" }));
		expect(extractParamsFromWrapperEl(chip)).toEqual({ title: "Auth options", timebox: "2d" });
		expect(prefillTemplateParams("custom.spike", chip)).toEqual({
			title: "Auth options",
			timebox: "2d",
		});
	});

	it("a section that was not rendered leaves its field out", () => {
		setCards(SPIKE);
		const { chip } = mount(render("custom.spike", { title: "Auth options" }));
		expect(extractParamsFromWrapperEl(chip)).toEqual({ title: "Auth options" });
	});

	it("a dropdown chip is read from data-tpl-value, not from the label text", () => {
		setCards(PRIO);
		const { chip } = mount(render("custom.prio", { level: "high" }));
		expect(chip.querySelector("[data-tpl-var=level]")?.textContent).toBe("High!");
		expect(extractParamsFromWrapperEl(chip)).toEqual({ level: "high" });
	});

	it("<br> in a textarea chip is read back as a newline", () => {
		setCards(NOTE);
		const { chip } = mount(render("custom.note", { body: "one\ntwo\nthree" }));
		expect(chip.querySelector("br")).not.toBeNull();
		expect(extractParamsFromWrapperEl(chip)).toEqual({ body: "one\ntwo\nthree" });
	});

	it("extraction of a built-in chip is unchanged: trimmed text, no data-tpl-value, textContent as before", () => {
		const html =
			'<span data-template-wrapper="w1" data-template-key="agile.epic" data-order-tag="artifact-item-type">' +
			'<mark><span data-tpl-var="title">  Login flow </span><span data-tpl-var="details">a<br>b</span></mark></span>';
		const { chip } = mount(html);
		expect(extractParamsFromWrapperEl(chip)).toEqual({ title: "Login flow", details: "ab" });
	});
});

describe("edit: prefill, GP5 and round trips through the real edit flow", () => {
	it("GP5: clearing Timebox gives '🧪 Auth options' with no empty parentheses", async () => {
		setCards(SPIKE);
		const chipHtml = render("custom.spike", { title: "Auth options", timebox: "2d" });
		expect(chipHtml).toContain('<span data-tpl-var="timebox">2d</span>');
		const res = await edit(chipHtml, (schema) => {
			// prefilled from the chip, by field name
			expect(schema.fields.map((f) => [f.name, f.defaultValue])).toEqual([
				["title", "Auth options"],
				["timebox", "2d"],
			]);
			return { title: "Auth options", timebox: "" };
		});
		expect(res.deps.notices?.error).not.toHaveBeenCalled();
		const written = res.writeFile.mock.calls[0][1];
		expect(written).toContain('<span data-tpl-var="title">Auth options</span></mark></span>');
		expect(written).not.toContain("timebox");
		expect(written).not.toContain("()");
		// the instance id is kept
		expect(instanceOf(written)).toBe(instanceOf(chipHtml));
	});

	it("opens 'Edit Spike' as an edit (isEdit true) with the custom schema", async () => {
		setCards(SPIKE);
		await edit(render("custom.spike", { title: "T" }), () => undefined);
		const [, schema, isEdit] = showSchema.mock.calls[0] as [
			unknown,
			{ titles?: { create: string; edit: string } },
			boolean,
		];
		expect(isEdit).toBe(true);
		expect(schema.titles).toEqual({ create: "Create Spike", edit: "Edit Spike" });
	});

	it("E5: values with < > & \" and {{title}} come back as typed and re-render to the same bytes", async () => {
		setCards(SPIKE);
		const nasty = `<b>"x" & y</b> {{title}}`;
		const chipHtml = render("custom.spike", { title: nasty, timebox: "{{timebox}}&" });
		await expect(
			edit(chipHtml, (schema) => {
				// the dialog is prefilled with the raw values...
				expect(schema.fields.map((f) => f.defaultValue)).toEqual([nasty, "{{timebox}}&"]);
				// ...and saving them unchanged re-renders the identical chip, which the edit
				// flow reports as "no changes" instead of writing.
				return { title: nasty, timebox: "{{timebox}}&" };
			})
		).rejects.toThrow("Template edit produced no changes");
	});

	it("a multi-line textarea value is prefilled with real newlines and re-renders the same", async () => {
		setCards(NOTE);
		const body = "line one\nline two\n\nline four";
		const chipHtml = render("custom.note", { body });
		await expect(
			edit(chipHtml, (schema) => {
				expect(schema.fields[0].defaultValue).toBe(body);
				return { body: schema.fields[0].defaultValue };
			})
		).rejects.toThrow("Template edit produced no changes");
	});

	it("a dropdown is prefilled from data-tpl-value (the value), not the label", async () => {
		setCards(PRIO);
		const chipHtml = render("custom.prio", { level: "high" });
		const res = await edit(chipHtml, (schema) => {
			expect(schema.fields[0].defaultValue).toBe("high");
			return { level: "low" };
		});
		expect(res.writeFile.mock.calls[0][1]).toContain(
			'<span data-tpl-var="level" data-tpl-value="low">Low</span>'
		);
	});

	it("a dropdown option whose label is a prefix of another's is still preselected by value", async () => {
		const both = card({
			id: "custom.size",
			label: "Size",
			fields: [
				{
					name: "size",
					type: "dropdown",
					options: [
						{ label: "Large", value: "l" },
						{ label: "Extra large", value: "xl" },
					],
				},
			],
			text: "{{size}}",
		});
		setCards(both);
		await edit(render("custom.size", { size: "xl" }), (schema) => {
			expect(schema.fields[0].defaultValue).toBe("xl");
			return undefined;
		});
	});
});

describe("G18: changing a definition never changes a chip already written", () => {
	it("the stored chip is byte-for-byte the same; the next edit uses the new definition", async () => {
		setCards(SPIKE);
		const written = render("custom.spike", { title: "Auth options", timebox: "2d" });

		// Rename timebox -> estimate, add a field, change the label and the emoji.
		const v2 = card({
			id: "custom.spike",
			label: "Spike v2",
			emoji: "🔬",
			fields: [
				{ name: "title", required: true },
				{ name: "estimate" },
				{ name: "owner" },
			],
			text: "{{title}} {{estimate}} {{owner}}",
		});
		setCards(v2);

		// 1) Nothing rewrote the chip: the text in the note is exactly what was written.
		const note = `- [ ] ${written}`;
		const before = note;
		reloadCustomTemplates();
		expect(note).toBe(before);

		// 2) The edit dialog is the new one, prefilled only from fields that kept their name.
		const res = await edit(written, (schema) => {
			expect(schema.fields.map((f) => [f.name, f.defaultValue])).toEqual([
				["title", "Auth options"],
				["estimate", undefined],
				["owner", undefined],
			]);
			return { title: "Auth options", estimate: "3d", owner: "sam" };
		});
		// 3) The renamed field's old value (timebox 2d) is gone only now, at the re-render.
		const saved = res.writeFile.mock.calls[0][1];
		expect(saved).toContain("🔬 ");
		expect(saved).not.toContain("timebox");
		expect(saved).not.toContain(">2d<");
		expect(saved).toContain('<span data-tpl-var="estimate">3d</span>');
	});
});

describe("G17 / GP8: a deleted, invalid or disabled template's chip stays exactly as written", () => {
	function attach(root: HTMLElement) {
		const renderSpy = vi.fn(async () => "<span/>");
		const writeSpy = vi.fn(async () => {});
		const deps: AppDeps = {
			templating: {
				findTemplateById: (id) => {
					const d = findTemplateById(id);
					return d
						? { id: d.id, hasParams: !!d.hasParams, paramsSchema: d.paramsSchema }
						: undefined;
				},
				prefillTemplateParams: vi.fn(() => ({})),
				renderTemplateOnly: renderSpy,
				showSchemaModal: showSchema,
				showJsonModal: showJson,
			},
			vault: { readFile: vi.fn(async () => ""), writeFile: writeSpy },
			refresh: { refreshForFile: async () => {} },
			notices: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
		};
		attachEditorTemplatingHandler({
			app: {} as App,
			viewContainer: root,
			registerDomEvent: (el, type, handler, options) =>
				el.addEventListener(type, handler as EventListener, options),
			deps,
			filePath: () => FILE,
			getLineHint0: () => 0,
			useObsidianNotice: false,
		});
		return { deps, renderSpy, writeSpy };
	}

	it("GP8: after removal and reload the chip is unchanged and double-click opens nothing", async () => {
		setCards(SPIKE, RESEARCH);
		const chipHtml = render("custom.research", { title: "Auth options", timebox: "2d" });
		const { root, chip } = mount(chipHtml);
		const { deps, renderSpy, writeSpy } = attach(root);
		const before = root.innerHTML;

		setCards(SPIKE); // custom.research removed from customTemplates
		const evt = new MouseEvent("dblclick", { bubbles: true, cancelable: true });
		expect(() => chip.dispatchEvent(evt)).not.toThrow();
		await new Promise((r) => setTimeout(r, 20));

		expect(evt.defaultPrevented).toBe(false);
		expect(showSchema).not.toHaveBeenCalled();
		expect(showJson).not.toHaveBeenCalled();
		expect(renderSpy).not.toHaveBeenCalled();
		expect(writeSpy).not.toHaveBeenCalled();
		expect(deps.notices?.warn).not.toHaveBeenCalled();
		expect(deps.notices?.error).not.toHaveBeenCalled();
		expect(root.innerHTML).toBe(before);
	});

	it("an invalid card (never loaded) is the same as deleted", async () => {
		setCards(SPIKE);
		const html = render("custom.spike", { title: "x" });
		setCards('{"id": "custom.spike", "label": 1}');
		const { root, chip } = mount(html);
		const { deps } = attach(root);
		const evt = new MouseEvent("dblclick", { bubbles: true, cancelable: true });
		chip.dispatchEvent(evt);
		await new Promise((r) => setTimeout(r, 10));
		expect(evt.defaultPrevented).toBe(false);
		expect(showSchema).not.toHaveBeenCalled();
		expect(deps.notices?.warn).not.toHaveBeenCalled();
	});

	it("a single click on a removed template's chip opens no sequence menu", () => {
		// The sequencer's eligible set no longer contains it.
		setCards(SPIKE, RESEARCH);
		expect(computeAvailableMoves("custom.research", {}).forward).toHaveLength(1);
		setCards(SPIKE);
		expect(computeAvailableMoves("custom.research", {})).toEqual({ forward: [], backward: [] });
		expect(computeAvailableMoves("custom.spike", {})).toEqual({ forward: [], backward: [] });
	});

	it("GP8: Remove Template still removes the chip of a deleted custom template", () => {
		setCards(RESEARCH);
		const chipHtml = render("custom.research", { title: "Auth options", timebox: "2d" });
		setCards(); // deleted
		const line = `- [ ] Task ${chipHtml} tail`;

		let onEditorMenu!: (menu: unknown, editor: unknown, view: unknown, info?: unknown) => void;
		const app = {
			workspace: {
				on: (name: string, cb: typeof onEditorMenu) => {
					if (name === "editor-menu") onEditorMenu = cb;
					return {};
				},
			},
		} as unknown as App;
		const rootEl = document.createElement("div");
		const editor = {
			getLine: () => line,
			getCursor: () => ({ line: 0, ch: 0 }),
			replaceRange: vi.fn(),
			setCursor: vi.fn(),
		};
		const ch = line.indexOf("Auth options") + 2;
		const view = {
			editor: Object.assign(editor, { cm: { contentDOM: rootEl } }),
			containerEl: document.createElement("div"),
		};
		const plugin = {
			registerDomEvent: vi.fn(),
			registerEvent: vi.fn(),
			register: vi.fn(),
			settings: { enableUxRepeatAgileTemplates: true },
		};
		wireTemplatingUxShortcutsDomHandlers(app, view as never, plugin as never);
		let onClick: (() => void) | undefined;
		onEditorMenu(
			{
				addItem: (fn: (i: unknown) => void) =>
					fn({
						setIcon: () => {},
						setTitle: () => {},
						onClick: (cb: () => void) => (onClick = cb),
					}),
			},
			editor,
			view,
			{ pos: { line: 0, ch } }
		);
		expect(onClick).toBeDefined();
		onClick!();
		const [next] = editor.replaceRange.mock.calls[0] as unknown as [string];
		// the chip goes, the rest of the line stays (the formatter's own spacing rule applies)
		expect(next).toBe("- [ ] Task tail");
	});

	it("a chip of the Default set switched off is left as written too", async () => {
		const html = render("agile.epic", { title: "Login flow", details: "x" });
		const { root, chip } = mount(html);
		const { deps } = attach(root);
		setDefaultTemplatesEnabled(false);
		const evt = new MouseEvent("dblclick", { bubbles: true, cancelable: true });
		chip.dispatchEvent(evt);
		await new Promise((r) => setTimeout(r, 10));
		expect(evt.defaultPrevented).toBe(false);
		expect(showSchema).not.toHaveBeenCalled();
		expect(deps.notices?.warn).not.toHaveBeenCalled();
	});
});

describe("GP6: a single click on the Spike chip offers Research; choosing it keeps the values", () => {
	it("offers 'Research' and the move renders a Research chip with the same values", async () => {
		setCards(SPIKE, RESEARCH);
		const spikeHtml = render("custom.spike", { title: "Auth options", timebox: "2d" });
		const { chip } = mount(spikeHtml);

		const params = extractParamsFromWrapperEl(chip);
		const moves = computeAvailableMoves("custom.spike", params);
		expect(moves.forward.map((s) => s.targetTemplate)).toEqual(["custom.research"]);

		let content = `- [ ] ${spikeHtml}`;
		const file = Object.assign(new TFile(), { path: FILE });
		const app = {
			vault: {
				getAbstractFileByPath: (p: string) => (p === FILE ? file : null),
				read: async () => content,
				modify: async (_f: unknown, c: string) => {
					content = c;
				},
			},
		} as unknown as App;

		await executeSequenceMoveOnFile({
			app,
			filePath: FILE,
			line0: 0,
			wrapperEl: chip,
			currentTemplateKey: "custom.spike",
			currentInstanceId: chip.getAttribute("data-template-wrapper"),
			sequence: moves.forward[0],
			direction: "forward",
		});

		expect(showSchema).not.toHaveBeenCalled(); // nothing missing: no extra dialog
		const { chip: after } = mount(content.replace(/^- \[ \] /, ""));
		expect(after.getAttribute("data-template-key")).toBe("custom.research");
		expect(extractParamsFromWrapperEl(after)).toEqual({ title: "Auth options", timebox: "2d" });
		expect(after.textContent).toBe("🔎 Auth options (2d)");
		expect(after.querySelector("mark")?.getAttribute("style")).toContain("#26A69A");
	});
});
