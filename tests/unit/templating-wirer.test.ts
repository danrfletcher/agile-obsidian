import { beforeEach, describe, expect, it, vi } from "vitest";

const { dom, ux, seq } = vi.hoisted(() => ({
	dom: vi.fn(),
	ux: vi.fn(),
	seq: vi.fn(),
}));

vi.mock("@features/templating-engine", () => ({ wireTemplatingDomHandlers: dom }));
vi.mock("@features/templating-ux-shortcuts", () => ({
	wireTemplatingUxShortcutsDomHandlers: ux,
}));
vi.mock("@features/templating-sequencer", () => ({
	wireTemplatingSequencerDomHandlers: seq,
}));

import { createTemplatingWirer } from "../../src/composition/wire/templating";

type ViewArg = Parameters<ReturnType<typeof createTemplatingWirer>>[0];
const makeView = (root: object) =>
	({
		editor: { cm: { contentDOM: root } },
		containerEl: {},
	}) as unknown as ViewArg;

const make = () =>
	createTemplatingWirer({} as never, {} as never);

describe("createTemplatingWirer (E11: no duplicate listeners)", () => {
	beforeEach(() => {
		dom.mockClear();
		ux.mockClear();
		seq.mockClear();
	});

	it("wires all three handlers once for a view", () => {
		const wire = make();
		wire(makeView({}));
		expect(dom).toHaveBeenCalledTimes(1);
		expect(ux).toHaveBeenCalledTimes(1);
		expect(seq).toHaveBeenCalledTimes(1);
	});

	it("does not wire the same view and editor root again (A -> B -> A)", () => {
		const wire = make();
		const a = makeView({});
		const b = makeView({});
		wire(a);
		wire(b);
		wire(a);
		expect(dom).toHaveBeenCalledTimes(2);
		expect(ux).toHaveBeenCalledTimes(2);
		expect(seq).toHaveBeenCalledTimes(2);
	});

	it("wires again when the view's editor root element was replaced", () => {
		const wire = make();
		const view = makeView({});
		wire(view);
		(view as unknown as { editor: { cm: { contentDOM: object } } }).editor.cm.contentDOM = {};
		wire(view);
		expect(dom).toHaveBeenCalledTimes(2);
	});

	it("a fresh wirer (plugin re-enabled) wires again", () => {
		const view = makeView({});
		make()(view);
		make()(view);
		expect(dom).toHaveBeenCalledTimes(2);
	});

	it("one handler throwing does not stop the others", () => {
		dom.mockImplementationOnce(() => {
			throw new Error("boom");
		});
		make()(makeView({}));
		expect(ux).toHaveBeenCalledTimes(1);
		expect(seq).toHaveBeenCalledTimes(1);
	});
});
