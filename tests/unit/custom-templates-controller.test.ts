import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createCustomTemplatesController,
	VALIDATE_DEBOUNCE_MS,
} from "@settings/app/custom-templates-controller";
import type { CardStatus } from "@settings/app/custom-templates-settings";
import { buildStarterText } from "@settings/app/custom-templates-settings";
import { validateCustomTemplateCard } from "@features/templating-engine/app/custom-templates";

// The fixture: one valid, one invalid schema, one malformed JSON.
const VALID = JSON.stringify({
	id: "custom.spike",
	label: "Spike",
	emoji: "🧪",
	fields: [{ name: "title", required: true }, { name: "timebox" }],
	text: "{{title}}{{#timebox}} ({{timebox}}){{/timebox}}",
});
// Valid too, with an id of its own (for typing into a card that is not the first).
const VALID_B = JSON.stringify({ ...JSON.parse(VALID), id: "custom.other" });
const INVALID_SCHEMA = JSON.stringify({
	id: "custom.bad",
	label: "Bad",
	fields: [{ name: "title" }, {}],
	text: "{{title}}",
});
const MALFORMED = '{"id": "custom.broken",';

function parserMessage(text: string): string {
	try {
		JSON.parse(text);
	} catch (e) {
		return (e as Error).message;
	}
	throw new Error("expected a syntax error");
}

function setup(initial: string[] = [VALID, INVALID_SCHEMA, MALFORMED]) {
	let texts = [...initial];
	const statuses: Array<{ index: number; status: CardStatus }> = [];
	const order: string[] = [];
	const saveSettings = vi.fn(async () => {
		order.push("save");
	});
	const rebuildRegistry = vi.fn(() => {
		order.push("rebuild");
	});
	const validate = vi.fn((t: readonly string[], i: number) =>
		validateCustomTemplateCard(t, i)
	);
	const onStatus = vi.fn((index: number, status: CardStatus) => {
		statuses.push({ index, status });
	});
	const onListChange = vi.fn();
	const onError = vi.fn();
	const controller = createCustomTemplatesController({
		getTexts: () => texts,
		setTexts: (t) => {
			texts = t;
		},
		saveSettings,
		rebuildRegistry,
		validate,
		onStatus,
		onListChange,
		onError,
	});
	const lastStatus = (index: number) =>
		[...statuses].reverse().find((s) => s.index === index)?.status;
	return {
		controller,
		get texts() {
			return texts;
		},
		statuses,
		order,
		saveSettings,
		rebuildRegistry,
		validate,
		onStatus,
		onListChange,
		onError,
		lastStatus,
	};
}

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
});

describe("debounce: validation 300 ms after the last keystroke", () => {
	it("is 300 ms", () => {
		expect(VALIDATE_DEBOUNCE_MS).toBe(300);
	});

	it("validates nothing while typing, and once when the burst ends", () => {
		const h = setup();
		h.controller.input(0, "{");
		vi.advanceTimersByTime(299);
		expect(h.validate).not.toHaveBeenCalled();
		expect(h.onStatus).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(h.validate).toHaveBeenCalledTimes(1);
		expect(h.onStatus).toHaveBeenCalledTimes(1);
	});

	it("one validation per burst, of the latest text", () => {
		const h = setup();
		// ten keystrokes, 100 ms apart: each one restarts the 300 ms wait
		for (let i = 1; i <= 10; i++) {
			h.controller.input(2, VALID_B.slice(0, i * 5));
			vi.advanceTimersByTime(100);
		}
		expect(h.validate).not.toHaveBeenCalled();
		vi.advanceTimersByTime(200);
		expect(h.validate).toHaveBeenCalledTimes(1);
		const [texts, index] = h.validate.mock.calls[0];
		expect(index).toBe(2);
		expect(texts[2]).toBe(VALID_B.slice(0, 50));
		expect(h.statuses).toHaveLength(1);
		// a second burst is a second validation
		h.controller.input(2, VALID_B);
		vi.advanceTimersByTime(300);
		expect(h.validate).toHaveBeenCalledTimes(2);
		expect(h.lastStatus(2)).toEqual({ valid: true, lines: ["Valid"] });
	});

	it("shows Valid, the validator's path lines, or the parser message", () => {
		const h = setup();
		h.controller.input(0, VALID);
		h.controller.input(1, INVALID_SCHEMA);
		h.controller.input(2, MALFORMED);
		vi.advanceTimersByTime(300);
		expect(h.lastStatus(0)).toEqual({ valid: true, lines: ["Valid"] });
		expect(h.lastStatus(1)).toEqual({
			valid: false,
			lines: ["fields[1].name: required"],
		});
		expect(h.lastStatus(2)).toEqual({
			valid: false,
			lines: [parserMessage(MALFORMED)],
		});
	});

	it("keeps a separate wait for each box", () => {
		const h = setup();
		h.controller.input(0, VALID);
		vi.advanceTimersByTime(200);
		h.controller.input(1, INVALID_SCHEMA);
		vi.advanceTimersByTime(100);
		expect(h.statuses.map((s) => s.index)).toEqual([0]);
		vi.advanceTimersByTime(200);
		expect(h.statuses.map((s) => s.index)).toEqual([0, 1]);
	});

	it("typing never saves or rebuilds", async () => {
		const h = setup();
		h.controller.input(0, "changed");
		vi.advanceTimersByTime(5000);
		await vi.runAllTimersAsync();
		expect(h.saveSettings).not.toHaveBeenCalled();
		expect(h.rebuildRegistry).not.toHaveBeenCalled();
		expect(h.texts[0]).toBe(VALID);
	});

	it("validates the typed text against the saved text of the other cards", () => {
		const dup = JSON.stringify({ ...JSON.parse(VALID) });
		const h = setup([VALID, MALFORMED]);
		h.controller.input(1, dup); // same id as card 0
		vi.advanceTimersByTime(300);
		expect(h.lastStatus(1)).toEqual({
			valid: false,
			lines: ['id: "custom.spike" is already used by another template'],
		});
		expect(h.texts[1]).toBe(MALFORMED); // nothing saved by typing
	});
});

describe("blur", () => {
	it("flushes: shows the latest text's status at once, without waiting for the debounce", async () => {
		const h = setup();
		h.controller.input(2, "{");
		vi.advanceTimersByTime(100); // inside the 300 ms
		await h.controller.blur(2, VALID_B);
		expect(h.lastStatus(2)).toEqual({ valid: true, lines: ["Valid"] });
		expect(h.texts[2]).toBe(VALID_B);
	});

	it("a stale debounced result never overwrites the newer status", async () => {
		const h = setup();
		h.controller.input(2, "{"); // would say a syntax error
		vi.advanceTimersByTime(250);
		h.controller.input(2, INVALID_SCHEMA); // newer text, not yet validated
		await h.controller.blur(2, VALID_B); // newest text, valid
		const shown = h.statuses.length;
		await vi.advanceTimersByTimeAsync(5000);
		// nothing more was shown after the blur: the old timers are gone
		expect(h.statuses.length).toBe(shown);
		expect(h.lastStatus(2)).toEqual({ valid: true, lines: ["Valid"] });
		// and exactly one validation ran for card 2 (the blur's)
		expect(
			h.validate.mock.calls.filter(([, i]) => i === 2)
		).toHaveLength(1);
	});

	it("saves the text exactly as typed and rebuilds the registry once, save first", async () => {
		const h = setup();
		const typed = '  {"id":"custom.spike",\n\t"label":"Spike 2"  ';
		await h.controller.blur(0, typed);
		expect(h.texts).toEqual([typed, INVALID_SCHEMA, MALFORMED]);
		expect(h.saveSettings).toHaveBeenCalledTimes(1);
		expect(h.rebuildRegistry).toHaveBeenCalledTimes(1);
		expect(h.order).toEqual(["save", "rebuild"]);
	});

	it("saves invalid and malformed text too (kept as typed)", async () => {
		const h = setup([VALID]);
		await h.controller.blur(0, MALFORMED);
		expect(h.texts).toEqual([MALFORMED]);
		expect(h.lastStatus(0)).toEqual({
			valid: false,
			lines: [parserMessage(MALFORMED)],
		});
		expect(h.saveSettings).toHaveBeenCalledTimes(1);
		expect(h.rebuildRegistry).toHaveBeenCalledTimes(1);
	});

	it("keeps an emptied box as an empty string in the array and shows the parser message", async () => {
		const h = setup();
		await h.controller.blur(0, "");
		expect(h.texts).toEqual(["", INVALID_SCHEMA, MALFORMED]);
		expect(h.texts).toHaveLength(3);
		expect(h.lastStatus(0)).toEqual({
			valid: false,
			lines: [parserMessage("")],
		});
		expect(h.saveSettings).toHaveBeenCalledTimes(1);
	});

	it("unchanged text: no save, no rebuild, status still shown", async () => {
		const h = setup();
		await h.controller.blur(0, VALID);
		await h.controller.blur(1, INVALID_SCHEMA);
		await h.controller.blur(2, MALFORMED);
		expect(h.saveSettings).not.toHaveBeenCalled();
		expect(h.rebuildRegistry).not.toHaveBeenCalled();
		expect(h.statuses.map((s) => s.index)).toEqual([0, 1, 2]);
	});

	it("typing and then restoring the saved text is unchanged: nothing saved", async () => {
		const h = setup();
		h.controller.input(0, "x");
		h.controller.input(0, VALID);
		await h.controller.blur(0, VALID);
		expect(h.saveSettings).not.toHaveBeenCalled();
		expect(h.rebuildRegistry).not.toHaveBeenCalled();
	});

	it("one rebuild per changed blur: a second blur with the same text does nothing", async () => {
		const h = setup();
		await h.controller.blur(0, "{}");
		await h.controller.blur(0, "{}");
		expect(h.saveSettings).toHaveBeenCalledTimes(1);
		expect(h.rebuildRegistry).toHaveBeenCalledTimes(1);
		await h.controller.blur(1, "{}");
		expect(h.saveSettings).toHaveBeenCalledTimes(2);
		expect(h.rebuildRegistry).toHaveBeenCalledTimes(2);
	});

	it("an unparseable card's blur leaves the other cards' text and status alone (E2)", async () => {
		const h = setup([VALID, INVALID_SCHEMA]);
		await h.controller.blur(1, '{"id":');
		expect(h.texts[0]).toBe(VALID);
		const forCard0 = h.statuses.filter((s) => s.index === 0);
		for (const s of forCard0) {
			expect(s.status).toEqual({ valid: true, lines: ["Valid"] });
		}
	});

	it("re-checks the other cards after a save: a later duplicate id gains the error, an earlier card stays valid", async () => {
		const other = JSON.stringify({ ...JSON.parse(VALID), id: "custom.other" });
		const h = setup([VALID, other]);
		h.statuses.length = 0;
		// card 0 takes the id card 1 already has: card 1 (later) is now the duplicate
		await h.controller.blur(0, other);
		expect(h.lastStatus(0)).toEqual({ valid: true, lines: ["Valid"] });
		expect(h.lastStatus(1)).toEqual({
			valid: false,
			lines: ['id: "custom.other" is already used by another template'],
		});
	});

	it("does not re-check a box that has typed text waiting", async () => {
		const h = setup([VALID, INVALID_SCHEMA, MALFORMED]);
		h.controller.input(2, "typing");
		h.statuses.length = 0;
		await h.controller.blur(0, "{}");
		expect(h.statuses.map((s) => s.index)).toEqual([0, 1]);
	});

	it("a blur for a card that is not there is ignored", async () => {
		const h = setup([VALID]);
		await h.controller.blur(5, "x");
		await h.controller.blur(-1, "x");
		expect(h.texts).toEqual([VALID]);
		expect(h.saveSettings).not.toHaveBeenCalled();
	});
});

describe("saves and rebuilds run in order", () => {
	it("two quick changed blurs: save, rebuild, save, rebuild", async () => {
		const h = setup();
		let release: (() => void) | undefined;
		h.saveSettings.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					release = () => {
						h.order.push("save");
						resolve();
					};
				})
		);
		const first = h.controller.blur(0, "{}");
		const second = h.controller.blur(1, "{}");
		await Promise.resolve();
		expect(h.rebuildRegistry).not.toHaveBeenCalled();
		release?.();
		await Promise.all([first, second]);
		expect(h.order).toEqual(["save", "rebuild", "save", "rebuild"]);
		expect(h.texts).toEqual(["{}", "{}", MALFORMED]);
	});

	it("a failed save is reported, the registry is still rebuilt, and later saves still run", async () => {
		const h = setup();
		h.saveSettings.mockRejectedValueOnce(new Error("disk full"));
		await h.controller.blur(0, "{}");
		expect(h.onError).toHaveBeenCalledTimes(1);
		expect(h.rebuildRegistry).toHaveBeenCalledTimes(1);
		await h.controller.blur(1, "{}");
		expect(h.saveSettings).toHaveBeenCalledTimes(2);
		expect(h.rebuildRegistry).toHaveBeenCalledTimes(2);
	});

	it("a failed rebuild is reported and does not stop the queue", async () => {
		const h = setup();
		h.rebuildRegistry.mockImplementationOnce(() => {
			throw new Error("boom");
		});
		await h.controller.blur(0, "{}");
		expect(h.onError).toHaveBeenCalledTimes(1);
		await h.controller.blur(1, "{}");
		expect(h.rebuildRegistry).toHaveBeenCalledTimes(2);
	});
});

describe("Add and Delete", () => {
	it("Add appends the starter, redraws, saves and rebuilds once, and the card is Valid", async () => {
		const h = setup([]);
		const index = await h.controller.add();
		expect(index).toBe(0);
		expect(h.texts).toEqual([buildStarterText(1)]);
		expect(h.onListChange).toHaveBeenCalledTimes(1);
		expect(h.saveSettings).toHaveBeenCalledTimes(1);
		expect(h.rebuildRegistry).toHaveBeenCalledTimes(1);
		expect(h.controller.status(0)).toEqual({ valid: true, lines: ["Valid"] });
		// the saved starter, blurred untouched, is not saved again
		await h.controller.blur(0, h.texts[0]);
		expect(h.saveSettings).toHaveBeenCalledTimes(1);
		expect(h.rebuildRegistry).toHaveBeenCalledTimes(1);
	});

	it("Add twice on an empty section: template-1 and template-2, both Valid (E15)", async () => {
		const h = setup([]);
		await h.controller.add();
		const second = await h.controller.add();
		expect(second).toBe(1);
		expect(
			h.texts.map((t) => (JSON.parse(t) as { id: string }).id)
		).toEqual(["custom.template-1", "custom.template-2"]);
		expect(h.controller.status(0).valid).toBe(true);
		expect(h.controller.status(1).valid).toBe(true);
		expect(h.rebuildRegistry).toHaveBeenCalledTimes(2);
	});

	it("Add reuses a gap even when a card is malformed but mentions the number", async () => {
		const h = setup([
			buildStarterText(1),
			'{"id":"custom.template-2",',
			buildStarterText(3),
		]);
		await h.controller.add();
		expect(h.texts[3]).toBe(buildStarterText(4));
		const h2 = setup([buildStarterText(1), buildStarterText(3)]);
		await h2.controller.add();
		expect(h2.texts[2]).toBe(buildStarterText(2));
	});

	it("Delete removes the card, redraws, saves and rebuilds; the others keep text and order", async () => {
		const h = setup();
		await h.controller.remove(1);
		expect(h.texts).toEqual([VALID, MALFORMED]);
		expect(h.onListChange).toHaveBeenCalledTimes(1);
		expect(h.saveSettings).toHaveBeenCalledTimes(1);
		expect(h.rebuildRegistry).toHaveBeenCalledTimes(1);
		expect(h.order).toEqual(["save", "rebuild"]);
		// statuses are recomputed for the new positions
		expect(h.controller.status(0).valid).toBe(true);
		expect(h.controller.status(1)).toEqual({
			valid: false,
			lines: [parserMessage(MALFORMED)],
		});
	});

	it("Delete drops what was typed in that box, and keeps what was typed in the others", async () => {
		const h = setup();
		h.controller.input(0, "typed in card 0, not blurred");
		h.controller.input(1, "typed in card 1, then deleted");
		await h.controller.remove(1);
		expect(h.texts).toEqual(["typed in card 0, not blurred", MALFORMED]);
		// no timer left to report on the old positions
		h.statuses.length = 0;
		await vi.advanceTimersByTimeAsync(5000);
		expect(h.statuses).toEqual([]);
	});

	it("Delete of a card that is not there does nothing", async () => {
		const h = setup();
		await h.controller.remove(7);
		await h.controller.remove(-1);
		expect(h.texts).toEqual([VALID, INVALID_SCHEMA, MALFORMED]);
		expect(h.saveSettings).not.toHaveBeenCalled();
		expect(h.onListChange).not.toHaveBeenCalled();
	});
});

describe("closing the tab", () => {
	it("flushAll saves a box that was typed in but never blurred, as typed", async () => {
		const h = setup();
		h.controller.input(0, "half-typed {");
		await h.controller.flushAll();
		expect(h.texts[0]).toBe("half-typed {");
		expect(h.saveSettings).toHaveBeenCalledTimes(1);
		expect(h.rebuildRegistry).toHaveBeenCalledTimes(1);
	});

	it("flushAll with nothing typed saves nothing", async () => {
		const h = setup();
		await h.controller.flushAll();
		expect(h.saveSettings).not.toHaveBeenCalled();
	});

	it("dispose cancels pending validations and silences the view, but a queued save still finishes", async () => {
		const h = setup();
		h.controller.input(0, "pending");
		h.controller.input(1, "to be saved");
		const flushed = h.controller.flushAll();
		h.controller.input(2, "typed after");
		h.controller.dispose();
		h.statuses.length = 0;
		await flushed;
		await vi.advanceTimersByTimeAsync(5000);
		expect(h.statuses).toEqual([]);
		expect(h.onStatus).toHaveBeenCalled(); // from before dispose
		expect(h.texts.slice(0, 2)).toEqual(["pending", "to be saved"]);
		expect(h.saveSettings).toHaveBeenCalledTimes(2);
	});

	it("after dispose, input and blur from the old box do nothing: no timer, no validation, no save", async () => {
		const h = setup();
		h.controller.dispose();
		const validations = h.validate.mock.calls.length;
		h.controller.input(0, "late keystroke");
		expect(vi.getTimerCount()).toBe(0);
		await h.controller.blur(0, "late blur");
		await vi.advanceTimersByTimeAsync(5000);
		expect(h.validate.mock.calls.length).toBe(validations);
		expect(h.saveSettings).not.toHaveBeenCalled();
		expect(h.rebuildRegistry).not.toHaveBeenCalled();
		expect(h.texts[0]).toBe(VALID);
	});
});
