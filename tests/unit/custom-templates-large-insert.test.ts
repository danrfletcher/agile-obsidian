// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
	LARGE_INSERT_MAX_CHARS,
	LARGE_INSERT_MAX_LINE_BREAKS,
	handleLargeInsert,
	isLargeInsert,
	normalizeInsertedText,
} from "../../src/settings/ui/views/large-insert";
import {
	createCustomTemplatesController,
	VALIDATE_DEBOUNCE_MS,
} from "@settings/app/custom-templates-controller";
import { validateCustomTemplateCard } from "@features/templating-engine/app/custom-templates";

const BODY =
	'{"id":"custom.big","label":"Big","fields":[{"name":"title","required":true}],"text":"{{title}}"}';
/** About 50 KB: 25,000 blank lines (the shape that froze the renderer) and a valid body. */
const FIFTY_KB = " \n".repeat(25_000) + BODY;

function makeBox(value = "", selection?: [number, number]) {
	const box = document.createElement("textarea");
	document.body.appendChild(box);
	box.value = value;
	if (selection) box.setSelectionRange(selection[0], selection[1]);
	return box;
}

function beforeInput(
	inputType: string,
	data: string | null,
	cancelable = true
): InputEvent {
	return new InputEvent("beforeinput", { inputType, data, cancelable, bubbles: true });
}

describe("isLargeInsert", () => {
	it.each([
		["empty", "", false],
		["a typed character", "a", false],
		["a normal pasted definition (30 lines)", "x\n".repeat(30), false],
		["exactly the line-break limit", "\n".repeat(LARGE_INSERT_MAX_LINE_BREAKS), false],
		["one more than the limit", "\n".repeat(LARGE_INSERT_MAX_LINE_BREAKS + 1), true],
		["CRLF counts each break once per char, so a long CRLF paste is large", "\r\n".repeat(60), true],
		["exactly the character limit, one line", "x".repeat(LARGE_INSERT_MAX_CHARS), false],
		["one more character than the limit", "x".repeat(LARGE_INSERT_MAX_CHARS + 1), true],
		["the 50 KB case", FIFTY_KB, true],
	])("%s", (_name, data, expected) => {
		expect(isLargeInsert(data)).toBe(expected);
	});
});

describe("normalizeInsertedText", () => {
	it("stores every line break as \\n, like a textarea does", () => {
		expect(normalizeInsertedText("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
	});
});

describe("handleLargeInsert", () => {
	it("takes over a 50 KB insert: cancels it, puts the text in the box, sends one input event", () => {
		const box = makeBox();
		const onInput = vi.fn();
		box.addEventListener("input", onInput);
		const ev = beforeInput("insertText", FIFTY_KB);
		box.dispatchEvent(ev);
		expect(handleLargeInsert(box, ev)).toBe(true);
		expect(ev.defaultPrevented).toBe(true);
		expect(box.value).toBe(FIFTY_KB);
		expect(box.selectionStart).toBe(FIFTY_KB.length);
		expect(box.selectionEnd).toBe(FIFTY_KB.length);
		expect(onInput).toHaveBeenCalledTimes(1);
	});

	it("replaces the selection like a paste and leaves the caret after the new text", () => {
		const box = makeBox("AAAA[old]ZZZZ", [4, 9]);
		const pasted = "p\n".repeat(LARGE_INSERT_MAX_LINE_BREAKS + 5);
		const ev = beforeInput("insertFromPaste", pasted);
		expect(handleLargeInsert(box, ev)).toBe(true);
		expect(box.value).toBe(`AAAA${pasted}ZZZZ`);
		expect(box.selectionStart).toBe(4 + pasted.length);
	});

	it("inserts at the caret when nothing is selected", () => {
		const box = makeBox("ab", [1, 1]);
		const pasted = "\n".repeat(LARGE_INSERT_MAX_LINE_BREAKS + 1);
		handleLargeInsert(box, beforeInput("insertFromDrop", pasted));
		expect(box.value).toBe(`a${pasted}b`);
	});

	it("stores CRLF pasted text with \\n only", () => {
		const box = makeBox();
		const pasted = "x\r\n".repeat(LARGE_INSERT_MAX_LINE_BREAKS + 1);
		handleLargeInsert(box, beforeInput("insertFromPaste", pasted));
		expect(box.value).not.toContain("\r");
		expect(box.value).toBe("x\n".repeat(LARGE_INSERT_MAX_LINE_BREAKS + 1));
	});

	it.each([
		["a small paste", "insertFromPaste", "x\n".repeat(20)],
		["a typed character", "insertText", "a"],
	])("leaves %s to the browser", (_n, type, data) => {
		const box = makeBox("keep");
		const onInput = vi.fn();
		box.addEventListener("input", onInput);
		const ev = beforeInput(type, data);
		expect(handleLargeInsert(box, ev)).toBe(false);
		expect(ev.defaultPrevented).toBe(false);
		expect(box.value).toBe("keep");
		expect(onInput).not.toHaveBeenCalled();
	});

	it.each([
		["a delete", "deleteContentBackward", null],
		["an Enter key", "insertLineBreak", null],
		["a history step", "historyUndo", FIFTY_KB],
	])("ignores %s", (_n, type, data) => {
		const box = makeBox("keep");
		const ev = beforeInput(type, data);
		expect(handleLargeInsert(box, ev)).toBe(false);
		expect(ev.defaultPrevented).toBe(false);
		expect(box.value).toBe("keep");
	});

	it("ignores an event that cannot be cancelled", () => {
		const box = makeBox("keep");
		const ev = beforeInput("insertText", FIFTY_KB, false);
		expect(handleLargeInsert(box, ev)).toBe(false);
		expect(box.value).toBe("keep");
	});

	it("works as a real beforeinput listener, so the browser's own insert never runs", () => {
		const box = makeBox();
		box.addEventListener("beforeinput", (e) => {
			handleLargeInsert(box, e);
		});
		const ev = beforeInput("insertText", FIFTY_KB);
		// dispatchEvent returns false when a listener cancelled the event.
		expect(box.dispatchEvent(ev)).toBe(false);
		expect(box.value).toBe(FIFTY_KB);
	});
});

describe("a 50 KB paste through the real controller and validator", () => {
	it("is one input event, one validation after the debounce, and the status is Valid", () => {
		vi.useFakeTimers();
		try {
			let texts: string[] = [""];
			const validate = vi.fn(validateCustomTemplateCard);
			const statuses: string[][] = [];
			const controller = createCustomTemplatesController({
				getTexts: () => texts,
				setTexts: (t) => {
					texts = t;
				},
				saveSettings: async () => {},
				rebuildRegistry: () => {},
				validate,
				onStatus: (_i, s) => statuses.push(s.lines),
				onListChange: () => {},
			});
			const box = makeBox();
			box.addEventListener("beforeinput", (e) => {
				handleLargeInsert(box, e);
			});
			box.addEventListener("input", () => controller.input(0, box.value));

			box.dispatchEvent(beforeInput("insertText", FIFTY_KB));
			// Nothing is validated on the input path itself.
			expect(validate).not.toHaveBeenCalled();
			vi.advanceTimersByTime(VALIDATE_DEBOUNCE_MS);
			expect(validate).toHaveBeenCalledTimes(1);
			expect(statuses).toEqual([["Valid"]]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("validates a 50 KB definition quickly (the validator was never the slow part)", () => {
		const t0 = Date.now();
		const v = validateCustomTemplateCard([FIFTY_KB], 0);
		expect(v.ok).toBe(true);
		expect(Date.now() - t0).toBeLessThan(500);
	});
});
