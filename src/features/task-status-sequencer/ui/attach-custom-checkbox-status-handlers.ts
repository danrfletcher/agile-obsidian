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

type EventWithStopImmediatePropagation = Event & {
	stopImmediatePropagation?: () => void;
};

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

	const setCheckedForStatus = (s: string): void => {
		checkboxEl.checked = s === "x";
	};

	const clearTimer = (): void => {
		if (pressTimer !== null) {
			window.clearTimeout(pressTimer);
			pressTimer = null;
		}
	};

	const performAdvance = async (): Promise<void> => {
		if (isUpdating) return;
		isUpdating = true;
		try {
			const predicted = getNextStatusChar(
				task.status ?? " ",
				DEFAULT_STATUS_SEQUENCE
			);
			await advanceTaskStatusForTaskItem({ app, task });
			task.status = predicted;
			setCheckedForStatus(predicted);
			onStatusApplied?.(predicted);
		} finally {
			isUpdating = false;
		}
	};

	const performCancel = async (): Promise<void> => {
		if (isUpdating) return;
		isUpdating = true;
		try {
			await setTaskStatusForTaskItem({
				app,
				task: { filePath: task.filePath, line0: task.line0 },
				to: "-",
			});
			task.status = "-";
			setCheckedForStatus("-");
			onStatusApplied?.("-");
		} finally {
			isUpdating = false;
		}
	};

	checkboxEl.addEventListener("change", (ev: Event) => {
		ev.preventDefault();
		(ev as EventWithStopImmediatePropagation).stopImmediatePropagation?.();
		setCheckedForStatus(task.status ?? " ");
	});

	checkboxEl.addEventListener("keydown", (ev: KeyboardEvent) => {
		const { key } = ev;
		if (key === " " || key === "Enter") {
			ev.preventDefault();
			ev.stopPropagation();
			void performAdvance();
		}
	});

	const onPressStart = (): void => {
		longApplied = false;
		clearTimer();
		pressTimer = window.setTimeout(() => {
			longApplied = true;
			void performCancel();
			suppressNextClick = true;
		}, longPressMs);
	};

	const onPressEnd = (ev?: Event): void => {
		const hadTimer = pressTimer !== null;
		clearTimer();
		if (longApplied) {
			if (ev) {
				try {
					ev.preventDefault();
					ev.stopPropagation();
					(
						ev as EventWithStopImmediatePropagation
					).stopImmediatePropagation?.();
				} catch {
					/* ignore */
				}
			}
			return;
		}
		if (hadTimer) {
			void performAdvance();
			suppressNextClick = true;
			if (ev) {
				try {
					ev.preventDefault();
					ev.stopPropagation();
					(
						ev as EventWithStopImmediatePropagation
					).stopImmediatePropagation?.();
				} catch {
					/* ignore */
				}
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
	});
	checkboxEl.addEventListener("touchend", onPressEnd);
	checkboxEl.addEventListener("touchcancel", () => clearTimer());

	checkboxEl.addEventListener("click", (ev: MouseEvent) => {
		if (suppressNextClick) {
			suppressNextClick = false;
			ev.preventDefault();
			ev.stopPropagation();
			(
				ev as EventWithStopImmediatePropagation
			).stopImmediatePropagation?.();
			return;
		}
		ev.preventDefault();
		ev.stopPropagation();
	});
}