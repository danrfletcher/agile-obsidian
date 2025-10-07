import { createSnoozeButton } from "./snooze-button";

/**
 * Specialized "Snooze All Subtasks" button with proper icon and title.
 * Reuses the generic SnoozeButton UI component.
 */
export function createSnoozeAllButton(options: {
	getTomorrowISO: () => string;
	onPerform: (dateISO: string) => Promise<void>;
}): HTMLButtonElement {
	return createSnoozeButton({
		icon: "💤⬇️",
		title: "Click: snooze all subtasks until tomorrow • Long-press: enter custom date",
		...options,
	});
}
