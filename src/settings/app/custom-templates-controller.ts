/**
 * Controller for the "Custom templates" settings section (no Obsidian, no DOM).
 *
 * The view forwards textarea events here and draws what comes back:
 * - `input(i, text)`: validation runs 300 ms after the last keystroke (debounced). A new
 *   keystroke cancels the pending run, so a burst costs one validation.
 * - `blur(i, text)`: cancels any pending run, shows the status of the latest text at once
 *   (so an older result can never overwrite it), and saves the text exactly as typed,
 *   valid or not. Then the registry is rebuilt. Unchanged text saves and rebuilds nothing.
 * - `add()` / `remove(i)`: change the array, save and rebuild straight away.
 *
 * Saves and rebuilds run in order, one after another. The array is changed synchronously
 * (so "is this text unchanged?" always compares with the latest state); only the
 * persistence is queued.
 *
 * The validator and the registry rebuild are injected (PR-5 owns them); this module never
 * looks inside card text.
 */

import {
	appendStarter,
	formatCardStatus,
	removeCard,
	type CardStatus,
	type CardValidation,
} from "./custom-templates-settings";

/** Quiet time after the last keystroke before validating. */
export const VALIDATE_DEBOUNCE_MS = 300;

export interface CustomTemplatesControllerDeps {
	/** The saved card texts, in card order (the live `settings.customTemplates`). */
	getTexts(): readonly string[];
	/** Replace the saved card texts in the live settings object. */
	setTexts(texts: string[]): void;
	/** Persist the settings (`saveData`). */
	saveSettings(): Promise<void>;
	/** Rebuild the live registry, commands and sequences from the saved texts (PR-5). */
	rebuildRegistry(): void;
	/** Validate card `index` of `texts`: the PR-5 validator, with the ids earlier cards hold. */
	validate(texts: readonly string[], index: number): CardValidation;
	/** Show a card's status. */
	onStatus(index: number, status: CardStatus): void;
	/** The set of cards changed (add / delete): redraw them. */
	onListChange(): void;
	/** A save or rebuild failed. */
	onError?(error: unknown): void;
	debounceMs?: number;
}

export interface CustomTemplatesController {
	/** The status of card `index` as saved. For drawing the cards. */
	status(index: number): CardStatus;
	input(index: number, text: string): void;
	blur(index: number, text: string): Promise<void>;
	/** Append a valid starter card; resolves with its position once saved and rebuilt. */
	add(): Promise<number>;
	/** Delete card `index`; resolves once saved and rebuilt. */
	remove(index: number): Promise<void>;
	/** Save every box that was typed in but not blurred yet (e.g. the tab is closing). */
	flushAll(): Promise<void>;
	/** Stop timers and stop calling `onStatus` / `onListChange`. Later `input` / `blur` calls do
	 * nothing. Queued saves still finish. Call `flushAll` first to keep typed text. */
	dispose(): void;
}

export function createCustomTemplatesController(
	deps: CustomTemplatesControllerDeps
): CustomTemplatesController {
	const debounceMs = deps.debounceMs ?? VALIDATE_DEBOUNCE_MS;
	const timers = new Map<number, ReturnType<typeof setTimeout>>();
	// Latest text typed in a box and not yet blurred.
	const typed = new Map<number, string>();
	let queue: Promise<void> = Promise.resolve();
	let disposed = false;

	function statusFor(index: number, text: string): CardStatus {
		const texts = [...deps.getTexts()];
		texts[index] = text;
		return formatCardStatus(deps.validate(texts, index));
	}

	function show(index: number, text: string): void {
		const status = statusFor(index, text);
		if (!disposed) deps.onStatus(index, status);
	}

	function cancelTimer(index: number): void {
		const t = timers.get(index);
		if (t !== undefined) clearTimeout(t);
		timers.delete(index);
	}

	function cancelAllTimers(): void {
		timers.forEach((t) => clearTimeout(t));
		timers.clear();
	}

	function fail(error: unknown): void {
		try {
			deps.onError?.(error);
		} catch {
			// reporting must never break the queue
		}
	}

	/** Save, then rebuild, after whatever is already queued. Rebuild runs even if the save
	 * failed: the live settings hold the new text, so the registry should match it. */
	function persist(): Promise<void> {
		queue = queue.then(async () => {
			try {
				await deps.saveSettings();
			} catch (e) {
				fail(e);
			}
			try {
				deps.rebuildRegistry();
			} catch (e) {
				fail(e);
			}
		});
		return queue;
	}

	/** After the array changed, other cards may have a new status (e.g. a duplicate id). */
	function refreshOthers(except: number): void {
		const texts = deps.getTexts();
		for (let j = 0; j < texts.length; j++) {
			if (j === except || typed.has(j)) continue;
			show(j, texts[j]);
		}
	}

	const self: CustomTemplatesController = {
		status(index) {
			return statusFor(index, deps.getTexts()[index] ?? "");
		},

		input(index, text) {
			// An event from a box that was already replaced must not start a timer.
			if (disposed) return;
			typed.set(index, text);
			cancelTimer(index);
			timers.set(
				index,
				setTimeout(() => {
					// Each keystroke and each blur cancels the previous timer, so this
					// text is still the newest one: an older result can never show.
					timers.delete(index);
					show(index, text);
				}, debounceMs)
			);
		},

		blur(index, text) {
			// Typed text was already saved by `flushAll` before the section was disposed.
			if (disposed) return queue;
			cancelTimer(index);
			typed.delete(index);
			show(index, text);
			const saved = deps.getTexts();
			if (index < 0 || index >= saved.length || saved[index] === text) {
				return queue;
			}
			const next = [...saved];
			next[index] = text;
			deps.setTexts(next);
			refreshOthers(index);
			return persist();
		},

		async add() {
			const { texts, index } = appendStarter(deps.getTexts());
			deps.setTexts(texts);
			if (!disposed) deps.onListChange();
			await persist();
			return index;
		},

		remove(index) {
			const current = deps.getTexts();
			if (index < 0 || index >= current.length) return queue;
			// Keep anything typed in the other boxes; drop what was typed in this one.
			const merged = [...current];
			typed.forEach((text, j) => {
				if (j !== index && j < merged.length) merged[j] = text;
			});
			cancelAllTimers();
			typed.clear();
			deps.setTexts(removeCard(merged, index));
			if (!disposed) deps.onListChange();
			return persist();
		},

		flushAll() {
			for (const [index, text] of Array.from(typed)) {
				void self.blur(index, text);
			}
			return queue;
		},

		dispose() {
			disposed = true;
			cancelAllTimers();
			typed.clear();
		},
	};
	return self;
}
