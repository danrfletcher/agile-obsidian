/**
 * UI adapter: Attach handlers to a custom view checkbox element to:
 * - Short press: advance by DEFAULT_STATUS_SEQUENCE
 * - Long press: set to "-" (cancel), applied immediately on timeout
 *
 * Suppresses the subsequent click and preserves input.checked only for 'x'.
 */
import type { App } from "obsidian";
import { LONG_PRESS_CANCEL_MS } from "../app/constants";
import {
	advanceTaskStatusForTaskItem,
	setTaskStatusForTaskItem,
} from "../app/task-status-for-task-item";
import {
	DEFAULT_STATUS_SEQUENCE,
	getNextStatusChar,
	type StatusChar,
} from "../domain/task-status-sequence";

export function attachCustomCheckboxStatusHandlers(opts: {
	checkboxEl: HTMLInputElement;
	app: App;
	task: {
		filePath: string;
		line0: number;
		status?: string | null | undefined;
	};
	longPressMs?: number;
	onStatusApplied?: (to: StatusChar) => void;
}) {
	const {
		checkboxEl,
		app,
		task,
		longPressMs = LONG_PRESS_CANCEL_MS,
		onStatusApplied,
	} = opts;

	let pressTimer: number | null = null;
	let longApplied = false; // true once we’ve performed cancel due to long-press
	let isUpdating = false;
	let suppressNextClick = false;

	const setCheckedForStatus = (s: StatusChar | string) => {
		checkboxEl.checked = s === "x";
	};

	const clearTimer = () => {
		if (pressTimer !== null) {
			window.clearTimeout(pressTimer);
			pressTimer = null;
		}
	};

	const performAdvance = async () => {
		if (isUpdating) return;
		isUpdating = true;
		try {
			const predicted = getNextStatusChar(
				task.status ?? " ",
				DEFAULT_STATUS_SEQUENCE
			);
			await advanceTaskStatusForTaskItem({ app, task });
			(task as any).status = predicted;
			setCheckedForStatus(predicted);
			onStatusApplied?.(predicted);
		} finally {
			isUpdating = false;
		}
	};

	const performCancel = async () => {
		if (isUpdating) return;
		isUpdating = true;
		try {
			await setTaskStatusForTaskItem({
				app,
				task: { filePath: task.filePath, line0: task.line0 },
				to: "-",
			});
			(task as any).status = "-";
			setCheckedForStatus("-");
			onStatusApplied?.("-");
		} finally {
			isUpdating = false;
		}
	};

	checkboxEl.addEventListener("change", (ev) => {
		ev.preventDefault();
		// @ts-ignore
		(ev as any).stopImmediatePropagation?.();
		setCheckedForStatus((task as any).status ?? " ");
	});

	checkboxEl.addEventListener("keydown", async (ev) => {
		const key = (ev as KeyboardEvent).key;
		if (key === " " || key === "Enter") {
			ev.preventDefault();
			ev.stopPropagation();
			await performAdvance();
		}
	});

	const onPressStart = () => {
		longApplied = false;
		clearTimer();
		pressTimer = window.setTimeout(async () => {
			longApplied = true;
			await performCancel();
			suppressNextClick = true;
		}, longPressMs);
	};

	const onPressEnd = async (ev?: Event) => {
		const hadTimer = pressTimer !== null;
		clearTimer();
		if (longApplied) {
			if (ev) {
				try {
					ev.preventDefault();
					ev.stopPropagation();
					// @ts-ignore
					(ev as any).stopImmediatePropagation?.();
				} catch {}
			}
			return;
		}
		if (hadTimer) {
			await performAdvance();
			suppressNextClick = true;
			if (ev) {
				try {
					ev.preventDefault();
					ev.stopPropagation();
					// @ts-ignore
					(ev as any).stopImmediatePropagation?.();
				} catch {}
			}
		}
	};

	checkboxEl.addEventListener("pointerdown", onPressStart);
	checkboxEl.addEventListener("pointerup", onPressEnd);
	checkboxEl.addEventListener("pointercancel", () => clearTimer());

	checkboxEl.addEventListener("mousedown", onPressStart);
	checkboxEl.addEventListener("mouseup", onPressEnd);
	checkboxEl.addEventListener("mouseleave", () => clearTimer());
	checkboxEl.addEventListener("touchstart", onPressStart, {
		passive: true,
	} as any);
	checkboxEl.addEventListener("touchend", onPressEnd);
	checkboxEl.addEventListener("touchcancel", () => clearTimer());

	checkboxEl.addEventListener("click", (ev) => {
		if (suppressNextClick) {
			suppressNextClick = false;
			ev.preventDefault();
			ev.stopPropagation();
			// @ts-ignore
			(ev as any).stopImmediatePropagation?.();
			return;
		}
		ev.preventDefault();
		ev.stopPropagation();
	});
}
