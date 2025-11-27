/**
 * A generic snooze button with:
 * - Click: use provided tomorrow date.
 * - Long-press: inline YYYY-MM-DD input; submits on Enter/blur with validation.
 *
 * UI-only: behavior is injected via onPerform(dateISO).
 */
export function createSnoozeButton(options: {
	icon?: string;
	title?: string;
	getTomorrowISO: () => string;
	onPerform: (dateISO: string) => Promise<void>;
}): HTMLButtonElement {
	const { icon = "💤", title, getTomorrowISO, onPerform } = options;

	const btn = globalThis.document.createElement("button");
	btn.type = "button";
	btn.textContent = icon;
	btn.classList.add("agile-snooze-btn");
	if (title) btn.title = title;

	let longPressTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
	let longPressed = false;
	const LONG_PRESS_MS = 500;

	const clearTimer = (): void => {
		if (longPressTimer !== null) {
			globalThis.clearTimeout(longPressTimer);
			longPressTimer = null;
		}
	};

	const restoreButton = (input: HTMLInputElement): void => {
		if (!input.isConnected) return;
		input.replaceWith(btn);
	};

	const showCustomDateInput = (): void => {
		longPressed = true;

		const input = globalThis.document.createElement("input");
		input.type = "text";
		input.placeholder = "Enter date (yyyy-mm-dd)";
		input.classList.add("agile-snooze-input");

		btn.replaceWith(input);

		const submit = async (): Promise<void> => {
			const val = input.value.trim();
			const isValid = /^\d{4}-\d{2}-\d{2}$/.test(val);
			if (!isValid) {
				restoreButton(input);
				return;
			}
			btn.textContent = "⏳";
			try {
				await onPerform(val);
			} finally {
				btn.textContent = icon;
			}
			restoreButton(input);
		};

		input.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "Enter") {
				void submit();
			}
			if (e.key === "Escape") {
				restoreButton(input);
			}
		});
		input.addEventListener("blur", () => restoreButton(input));

		input.focus();
	};

	const startLongPress = (ev: Event): void => {
		ev.stopPropagation();
		clearTimer();
		longPressed = false;
		longPressTimer = globalThis.setTimeout(
			showCustomDateInput,
			LONG_PRESS_MS
		);
	};

	const cancelLongPress = (): void => {
		clearTimer();
	};

	btn.addEventListener("click", (e) => {
		e.preventDefault();
		e.stopPropagation();
		if (longPressed) return;
		btn.textContent = "⏳";
		void (async () => {
			try {
				await onPerform(getTomorrowISO());
			} finally {
				btn.textContent = icon;
			}
		})();
	});

	btn.addEventListener("mousedown", startLongPress);
	btn.addEventListener("mouseup", cancelLongPress);
	btn.addEventListener("mouseleave", cancelLongPress);

	btn.addEventListener("touchstart", startLongPress, { passive: true });
	btn.addEventListener("touchend", cancelLongPress);
	btn.addEventListener("touchcancel", cancelLongPress);

	return btn;
}