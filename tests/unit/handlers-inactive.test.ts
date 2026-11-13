// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { openMenu, showSchema, showJson, cursorCtx } = vi.hoisted(() => ({
	openMenu: vi.fn(),
	showSchema: vi.fn(async () => undefined),
	showJson: vi.fn(async () => undefined),
	cursorCtx: vi.fn(),
}));

vi.mock("@features/templating-sequencer/ui/menu", () => ({
	openSequencerMenuAt: openMenu,
}));
// Keep the real line helpers (getLineKind etc.) that the insert path uses.
vi.mock("@platform/obsidian", async (orig) => ({
	...(await orig<Record<string, unknown>>()),
	getCursorContext: cursorCtx,
}));
// Keep the real params-editor, but never open a real modal: the user "cancels".
vi.mock("@features/templating-params-editor", async (orig) => ({
	...(await orig<Record<string, unknown>>()),
	showSchemaModal: showSchema,
	showJsonModal: showJson,
}));

import type { App, MarkdownView, Plugin } from "obsidian";
import { attachEditorTemplatingHandler } from "@features/templating-params-editor/ui/handlers/editor-click-handler";
import type { AppDeps } from "@features/templating-params-editor/app/ports";
import { findTemplateById } from "@features/templating-engine/app/templating-service";
import { wireTemplatingSequencerDomHandlers } from "@features/templating-sequencer/ui/handlers";
import { processEnter } from "@features/templating-ux-shortcuts/app/enter-repeat-agile-template";
import { wireTemplatingUxShortcutsDomHandlers } from "@features/templating-ux-shortcuts";
import {
	setCustomDefinitions,
	setDefaultTemplatesEnabled,
} from "@features/templating-engine/app/template-registry";
import { loadCustomTemplates } from "@features/templating-engine/app/custom-templates";

// Hand-written chips, as the plugin writes them into a note.
const EPIC_CHIP =
	'<span data-template-wrapper="w-epic" data-template-key="agile.epic" data-order-tag="artifact-item-type"><mark style="background: #ccc"><strong>Epic</strong> <span data-tpl-var="title">Login flow</span></mark></span>';
// Old Agile Obsidian chip of a template that no longer exists.
const ASSIGNEE_CHIP =
	'<span data-template-wrapper="w-asg" data-template-key="members.assignee" data-order-tag="assignment"><mark>@dan</mark></span>';

function mountChip(html: string): { root: HTMLElement; chip: HTMLElement } {
	const root = document.createElement("div");
	root.append(document.createRange().createContextualFragment(html));
	document.body.appendChild(root);
	const chip = root.querySelector("span[data-template-wrapper]") as HTMLElement;
	return { root, chip };
}

function fakePlugin() {
	return {
		registerDomEvent: (
			el: HTMLElement,
			type: string,
			cb: (e: Event) => void,
			opts?: AddEventListenerOptions | boolean
		) => el.addEventListener(type, cb, opts),
		register: vi.fn(),
	} as unknown as Plugin;
}

beforeEach(() => {
	setCustomDefinitions([]);
	setDefaultTemplatesEnabled(true);
	vi.clearAllMocks();
});
afterEach(() => {
	document.body.innerHTML = "";
	vi.useRealTimers();
	setCustomDefinitions([]);
	setDefaultTemplatesEnabled(true);
});

describe("double-click edit handler", () => {
	function attach(root: HTMLElement) {
		const prefill = vi.fn(() => ({ title: "Login flow" }));
		const render = vi.fn(async () => "<span/>");
		const writeFile = vi.fn(async () => {});
		const readFile = vi.fn(async () => "- [ ] x");
		const deps: AppDeps = {
			templating: {
				// the real registry-backed lookup, read at event time
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
				prefillTemplateParams: prefill,
				renderTemplateOnly: render,
				showSchemaModal: showSchema,
				showJsonModal: showJson,
			},
			vault: { readFile, writeFile },
			refresh: { refreshForFile: async () => {} },
			notices: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
		};
		attachEditorTemplatingHandler({
			app: {} as App,
			viewContainer: root,
			registerDomEvent: (el, type, handler, options) =>
				el.addEventListener(type, handler as EventListener, options),
			deps,
			filePath: () => "Scratch/templates-demo.md",
			getLineHint0: () => 0,
			useObsidianNotice: false,
		});
		return { deps, writeFile, readFile };
	}

	const dbl = (chip: HTMLElement) => {
		const evt = new MouseEvent("dblclick", { bubbles: true, cancelable: true });
		chip.dispatchEvent(evt);
		return evt;
	};

	it("control: with the set on, a built-in chip opens the edit dialog and prevents default", async () => {
		const { root, chip } = mountChip(EPIC_CHIP);
		attach(root);
		const evt = dbl(chip);
		expect(evt.defaultPrevented).toBe(true);
		await vi.waitFor(() => expect(showSchema).toHaveBeenCalledTimes(1));
	});

	it("with the set off, a built-in chip: no preventDefault, no dialog, no notice, chip untouched", async () => {
		setDefaultTemplatesEnabled(false);
		const { root, chip } = mountChip(EPIC_CHIP);
		const before = root.innerHTML;
		const { deps, writeFile } = attach(root);

		const evt = dbl(chip);
		await new Promise((r) => setTimeout(r, 20));

		expect(evt.defaultPrevented).toBe(false);
		expect(showSchema).not.toHaveBeenCalled();
		expect(showJson).not.toHaveBeenCalled();
		expect(deps.notices?.warn).not.toHaveBeenCalled();
		expect(deps.notices?.error).not.toHaveBeenCalled();
		expect(writeFile).not.toHaveBeenCalled();
		expect(root.innerHTML).toBe(before);
	});

	it("an unknown key (old members.assignee) behaves the same with the set on or off", async () => {
		for (const on of [true, false]) {
			setDefaultTemplatesEnabled(on);
			const { root, chip } = mountChip(ASSIGNEE_CHIP);
			const { deps } = attach(root);
			const evt = dbl(chip);
			await new Promise((r) => setTimeout(r, 10));
			expect(evt.defaultPrevented).toBe(false);
			expect(showSchema).not.toHaveBeenCalled();
			expect(deps.notices?.warn).not.toHaveBeenCalled();
			root.remove();
		}
	});

	it("switching the set off while the dialog is open cancels quietly: nothing written, no error", async () => {
		const { root, chip } = mountChip(EPIC_CHIP);
		const { deps, writeFile } = attach(root);
		let finish!: (v: Record<string, unknown>) => void;
		showSchema.mockImplementationOnce(
			() => new Promise((r) => (finish = r as typeof finish)) as never
		);
		const before = root.innerHTML;
		dbl(chip);
		await vi.waitFor(() => expect(showSchema).toHaveBeenCalledTimes(1));

		setDefaultTemplatesEnabled(false); // toggled while the dialog is open
		finish({ title: "Login flow v2" }); // the user saves

		await new Promise((r) => setTimeout(r, 20));
		expect(deps.templating.renderTemplateOnly).not.toHaveBeenCalled();
		expect(writeFile).not.toHaveBeenCalled();
		expect(deps.notices?.error).not.toHaveBeenCalled();
		expect(root.innerHTML).toBe(before);
	});
});

describe("sequencer click handler", () => {
	function wire(root: HTMLElement) {
		const view = {
			editor: { cm: { contentDOM: root } },
			containerEl: document.createElement("div"),
		} as unknown as MarkdownView;
		wireTemplatingSequencerDomHandlers({} as App, view, fakePlugin());
	}
	const click = (chip: HTMLElement) => {
		const evt = new MouseEvent("click", {
			bubbles: true,
			cancelable: true,
			detail: 1,
		});
		chip.dispatchEvent(evt);
		return evt;
	};

	it("control: with the set on, a single click on a built-in chip opens the menu", () => {
		vi.useFakeTimers();
		const { root, chip } = mountChip(EPIC_CHIP);
		wire(root);
		const evt = click(chip);
		expect(evt.defaultPrevented).toBe(true);
		vi.advanceTimersByTime(400);
		expect(openMenu).toHaveBeenCalledTimes(1);
	});

	it("with the set off, a single click opens no menu and is left alone", () => {
		vi.useFakeTimers();
		setDefaultTemplatesEnabled(false);
		const { root, chip } = mountChip(EPIC_CHIP);
		const before = root.innerHTML;
		wire(root);
		const evt = click(chip);
		vi.advanceTimersByTime(1000);
		expect(evt.defaultPrevented).toBe(false);
		expect(openMenu).not.toHaveBeenCalled();
		expect(root.innerHTML).toBe(before);
	});

	it("reads the eligible set at click time: handler wired before the toggle follows it both ways", () => {
		vi.useFakeTimers();
		const { root, chip } = mountChip(EPIC_CHIP);
		wire(root); // wired while on
		setDefaultTemplatesEnabled(false);
		click(chip);
		vi.advanceTimersByTime(400);
		expect(openMenu).not.toHaveBeenCalled();
		setDefaultTemplatesEnabled(true);
		click(chip);
		vi.advanceTimersByTime(400);
		expect(openMenu).toHaveBeenCalledTimes(1);
	});

	it("switching off during the click-defer window opens nothing", () => {
		vi.useFakeTimers();
		const { root, chip } = mountChip(EPIC_CHIP);
		wire(root);
		click(chip);
		setDefaultTemplatesEnabled(false);
		vi.advanceTimersByTime(400);
		expect(openMenu).not.toHaveBeenCalled();
	});

	it("an unknown key (old members.assignee) opens no menu, on or off", () => {
		vi.useFakeTimers();
		const { root, chip } = mountChip(ASSIGNEE_CHIP);
		wire(root);
		for (const on of [true, false]) {
			setDefaultTemplatesEnabled(on);
			const evt = click(chip);
			vi.advanceTimersByTime(400);
			expect(evt.defaultPrevented).toBe(false);
		}
		expect(openMenu).not.toHaveBeenCalled();
	});
});

describe("double-Enter repeat", () => {
	const SRC = `- [ ] Login flow ${EPIC_CHIP}`;

	function setupLines(src: string = SRC) {
		const lines = [src, "- [ ] "];
		const editor = {
			getLine: (n: number) => lines[n] ?? "",
			getCursor: () => ({ line: 1, ch: lines[1].length }),
			getValue: () => lines.join("\n"),
			replaceRange: vi.fn(),
		};
		const view = { editor } as unknown as MarkdownView;
		const ctxAt = (n: number) => ({
			filePath: "Scratch/templates-demo.md",
			lineNumber: n,
			column: (lines[n] ?? "").length,
			lineText: lines[n] ?? "",
			prevLineText: lines[n - 1],
		});
		return { editor, view, ctxAt };
	}
	const enter = () =>
		new KeyboardEvent("keydown", { key: "Enter", cancelable: true });

	async function doubleEnter(view: MarkdownView, ctxAt: (n: number) => unknown) {
		// First Enter on the chip line, caret at its end; Obsidian makes the new line.
		cursorCtx.mockResolvedValueOnce(ctxAt(0));
		const first = enter();
		await processEnter({} as App, view, first);
		// Second Enter, now on the new empty task line.
		cursorCtx.mockResolvedValueOnce(ctxAt(1));
		cursorCtx.mockResolvedValue(ctxAt(1));
		const second = enter();
		await processEnter({} as App, view, second);
		return { first, second };
	}

	it("control: with the set on, the second Enter is intercepted and the create dialog opens", async () => {
		const { view, ctxAt } = setupLines();
		const { first, second } = await doubleEnter(view, ctxAt);
		expect(first.defaultPrevented).toBe(false);
		expect(second.defaultPrevented).toBe(true);
		expect(showSchema).toHaveBeenCalledTimes(1);
	});

	it("with the set off, both Enters are normal and no dialog opens", async () => {
		setDefaultTemplatesEnabled(false);
		const { view, ctxAt, editor } = setupLines();
		const { first, second } = await doubleEnter(view, ctxAt);
		expect(first.defaultPrevented).toBe(false);
		expect(second.defaultPrevented).toBe(false);
		expect(showSchema).not.toHaveBeenCalled();
		expect(showJson).not.toHaveBeenCalled();
		expect(editor.replaceRange).not.toHaveBeenCalled();
	});

	/** Load one real custom template (JSON text -> validator -> registry) and write its chip. */
	function customChipLine(json: Record<string, unknown>, params: Record<string, unknown>) {
		const load = loadCustomTemplates([JSON.stringify(json)], []);
		expect(load.cards[0].errors).toEqual([]);
		setCustomDefinitions(load.definitions);
		const def = findTemplateById(json.id as string);
		if (!def?.render) throw new Error("custom template did not load");
		const chip = def.render(params);
		return `- [ ] Login flow ${chip}`;
	}

	it("a custom artifact-item-type template with fields repeats: dialog opens, then inserts", async () => {
		const src = customChipLine(
			{
				id: "custom.story",
				label: "Story",
				emoji: "📖",
				orderTag: "artifact-item-type",
				text: "Story {{title}}",
				fields: [{ name: "title", required: true }],
			},
			{ title: "Login flow" }
		);
		const { view, ctxAt, editor } = setupLines(src);
		showSchema.mockResolvedValueOnce({ title: "Next" } as never);
		const { first, second } = await doubleEnter(view, ctxAt);
		expect(first.defaultPrevented).toBe(false);
		expect(second.defaultPrevented).toBe(true);
		expect(showSchema).toHaveBeenCalledTimes(1);
		expect((showSchema.mock.calls[0] as unknown[])[1]).toBe("custom.story");
		expect(editor.replaceRange).toHaveBeenCalledTimes(1);
		const written = (editor.replaceRange.mock.calls[0] as unknown[])[0] as string;
		expect(written).toContain('data-template-key="custom.story"');
		expect(written).toContain("Next");
	});

	it("a custom artifact-item-type template with no fields repeats and inserts straight away, no dialog", async () => {
		const src = customChipLine(
			{
				id: "custom.bug",
				label: "Bug",
				emoji: "🐞",
				orderTag: "artifact-item-type",
				text: "Bug",
			},
			{}
		);
		const { view, ctxAt, editor } = setupLines(src);
		const { first, second } = await doubleEnter(view, ctxAt);
		expect(first.defaultPrevented).toBe(false);
		expect(second.defaultPrevented).toBe(true);
		expect(showSchema).not.toHaveBeenCalled();
		expect(showJson).not.toHaveBeenCalled();
		expect(editor.replaceRange).toHaveBeenCalledTimes(1);
		const written = (editor.replaceRange.mock.calls[0] as unknown[])[0] as string;
		expect(written).toContain('data-template-key="custom.bug"');
		expect(written).toContain('data-order-tag="artifact-item-type"');
		expect(written).toContain("🐞 Bug");
	});

	it("a no-field custom template deleted before the second Enter: normal Enter, nothing inserted", async () => {
		const src = customChipLine(
			{
				id: "custom.bug",
				label: "Bug",
				emoji: "🐞",
				orderTag: "artifact-item-type",
				text: "Bug",
			},
			{}
		);
		setCustomDefinitions([]);
		const { view, ctxAt, editor } = setupLines(src);
		const { first, second } = await doubleEnter(view, ctxAt);
		expect(first.defaultPrevented).toBe(false);
		expect(second.defaultPrevented).toBe(false);
		expect(editor.replaceRange).not.toHaveBeenCalled();
	});

	it("switching off while the create dialog is open inserts nothing", async () => {
		const { view, ctxAt, editor } = setupLines();
		let finish!: (v: Record<string, unknown>) => void;
		showSchema.mockImplementationOnce(
			() => new Promise((r) => (finish = r as typeof finish)) as never
		);
		const pending = doubleEnter(view, ctxAt);
		await vi.waitFor(() => expect(showSchema).toHaveBeenCalledTimes(1));
		setDefaultTemplatesEnabled(false);
		finish({ title: "Next" });
		await pending;
		expect(editor.replaceRange).not.toHaveBeenCalled();
	});
});

describe("right-click Remove Template", () => {
	/** Wire the real UX shortcuts and open the editor context menu on `line` at `ch`. */
	function removeFromMenu(line: string, ch: number) {
		let onEditorMenu!: (menu: unknown, editor: unknown, view: unknown, info?: unknown) => void;
		const app = {
			workspace: {
				on: (name: string, cb: typeof onEditorMenu) => {
					if (name === "editor-menu") onEditorMenu = cb;
					return {};
				},
			},
		} as unknown as App;
		const root = document.createElement("div");
		const editor = {
			getLine: () => line,
			getCursor: () => ({ line: 0, ch }),
			replaceRange: vi.fn(),
			setCursor: vi.fn(),
		};
		const view = {
			editor: Object.assign(editor, { cm: { contentDOM: root } }),
			containerEl: document.createElement("div"),
		} as unknown as MarkdownView;
		const plugin = Object.assign(fakePlugin(), {
			registerEvent: vi.fn(),
			settings: { enableUxRepeatAgileTemplates: true },
		});
		wireTemplatingUxShortcutsDomHandlers(app, view, plugin);

		let onClick: (() => void) | undefined;
		const menu = {
			addItem: (fn: (i: unknown) => void) =>
				fn({
					setIcon: () => {},
					setTitle: () => {},
					onClick: (cb: () => void) => (onClick = cb),
				}),
		};
		onEditorMenu(menu, editor, view, { pos: { line: 0, ch } });
		return { editor, onClick };
	}

	it("with the set off, removes a built-in chip's wrapper span and nothing else", () => {
		setDefaultTemplatesEnabled(false);
		const line = `- [ ] Login flow ${EPIC_CHIP} later`;
		const { editor, onClick } = removeFromMenu(line, line.indexOf("Login flow</span>") + 3);
		expect(onClick).toBeDefined(); // the menu item is offered for a built-in chip
		onClick!();
		expect(editor.replaceRange).toHaveBeenCalledTimes(1);
		const [next] = editor.replaceRange.mock.calls[0] as unknown as [string];
		expect(next).toBe("- [ ] Login flow later");
	});

	it("also removes an unknown (old members.assignee) chip, with the set on or off", () => {
		for (const on of [true, false]) {
			setDefaultTemplatesEnabled(on);
			const line = `- [ ] Task ${ASSIGNEE_CHIP}`;
			const { editor, onClick } = removeFromMenu(line, line.indexOf("@dan"));
			onClick!();
			const [next] = editor.replaceRange.mock.calls[0] as unknown as [string];
			expect(next).toBe("- [ ] Task ");
		}
	});
});
