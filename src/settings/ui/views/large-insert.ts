/**
 * Fast path for big pastes into a custom template box.
 *
 * Chromium inserts text into a <textarea> one line at a time (two `input` events and a
 * layout per line), which is quadratic in the number of lines: about 2 s for 2,000 lines
 * and minutes for 25,000 (measured in Chrome with no plugin code at all), and it blocks
 * the renderer for that whole time. A pasted definition is normally a few dozen lines,
 * so only an insert with many line breaks (or a lot of text) takes this path: the browser's
 * own insert is cancelled and the text is put in with one `setRangeText`, then one `input`
 * event is sent, so the debounce, validation and save work exactly as for any other edit.
 *
 * Smaller inserts and all typing stay native, so their undo behaviour is unchanged.
 * A large insert replaces the selection like a normal paste, but the browser's undo
 * stack for the box is reset, as for any script change to a textarea's value.
 */

/** More line breaks than this in one insert takes the fast path. */
export const LARGE_INSERT_MAX_LINE_BREAKS = 100;
/** More characters than this in one insert takes the fast path. */
export const LARGE_INSERT_MAX_CHARS = 10_000;

/** Input types that carry text the user is adding to the box. */
const INSERT_TYPES = new Set([
	"insertText",
	"insertFromPaste",
	"insertFromPasteAsQuotation",
	"insertFromDrop",
	"insertReplacementText",
]);

/** The inserted text as a textarea stores it: line breaks are always "\n". */
export function normalizeInsertedText(data: string): string {
	return data.replace(/\r\n?/g, "\n");
}

/** True when `data` is big enough that the browser's own insert would be too slow. */
export function isLargeInsert(data: string): boolean {
	if (data.length > LARGE_INSERT_MAX_CHARS) return true;
	let breaks = 0;
	for (let i = 0; i < data.length; i++) {
		const c = data.charCodeAt(i);
		if (c === 10 || c === 13) {
			breaks++;
			if (breaks > LARGE_INSERT_MAX_LINE_BREAKS) return true;
		}
	}
	return false;
}

/**
 * `beforeinput` handler for a card's textarea. Returns true when it took over the insert
 * (the event is cancelled, the text is in the box and an `input` event has been sent).
 * Returns false for anything else, which then goes through the browser as usual.
 */
export function handleLargeInsert(
	box: HTMLTextAreaElement,
	ev: InputEvent
): boolean {
	if (!ev.cancelable || !INSERT_TYPES.has(ev.inputType)) return false;
	// For a textarea the pasted/typed/dropped text is in `data`.
	const data = ev.data;
	if (typeof data !== "string" || !isLargeInsert(data)) return false;

	ev.preventDefault();
	box.setRangeText(
		normalizeInsertedText(data),
		box.selectionStart,
		box.selectionEnd,
		"end"
	);
	box.dispatchEvent(new Event("input", { bubbles: true }));
	return true;
}
