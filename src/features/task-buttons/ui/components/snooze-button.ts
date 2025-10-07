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

	const btn = document.createElement("button");
	btn.type = "button";
	btn.textContent = icon;
	btn.classList.add("agile-snooze-btn");
	btn.style.cursor = "pointer";
	btn.style.background = "none";
	btn.style.border = "none";
	btn.style.fontSize = "1em";
	btn.style.verticalAlign = "baseline";
	btn.style.marginLeft = "0";
	if (title) btn.title = title;

	let longPressTimer: number | null = null;
	let longPressed = false;
	const LONG_PRESS_MS = 500;

	const clearTimer = () => {
		if (longPressTimer !== null) {
			window.clearTimeout(longPressTimer);
			longPressTimer = null;
		}
	};

	const restoreButton = (input: HTMLInputElement) => {
		if (input.isConnected) {
			try {
				input.replaceWith(btn);
				btn.style.display = "";
			} catch {
				input.remove();
				btn.style.display = "";
			}
		}
	};

	const showCustomDateInput = () => {
		longPressed = true;

		const input = document.createElement("input");
		input.type = "text";
		input.placeholder = "YYYY-MM-DD";
		input.classList.add("agile-snooze-input");
		input.style.width = "120px";
		input.style.display = "inline-block";
		input.style.marginLeft = "8px";
		input.style.fontSize = "0.95em";
		input.style.verticalAlign = "baseline";

		const parent = btn.parentElement!;
		try {
			btn.replaceWith(input);
		} catch {
			btn.style.display = "none";
			parent.insertBefore(input, btn.nextSibling);
		}

		const submit = async () => {
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
			if (e.key === "Enter") submit();
			if (e.key === "Escape") restoreButton(input);
		});
		input.addEventListener("blur", () => restoreButton(input));

		input.focus();
	};

	const startLongPress = (ev: Event) => {
		ev.stopPropagation();
		clearTimer();
		longPressed = false;
		longPressTimer = window.setTimeout(showCustomDateInput, LONG_PRESS_MS);
	};

	const cancelLongPress = () => {
		clearTimer();
	};

	btn.addEventListener("click", async (e) => {
		e.preventDefault();
		e.stopPropagation();
		if (longPressed) return;
		btn.textContent = "⏳";
		try {
			await onPerform(getTomorrowISO());
		} finally {
			btn.textContent = icon;
		}
	});

	btn.addEventListener("mousedown", startLongPress);
	btn.addEventListener("mouseup", cancelLongPress);
	btn.addEventListener("mouseleave", cancelLongPress);

	btn.addEventListener("touchstart", startLongPress, { passive: true });
	btn.addEventListener("touchend", cancelLongPress);
	btn.addEventListener("touchcancel", cancelLongPress);

	return btn;
}
