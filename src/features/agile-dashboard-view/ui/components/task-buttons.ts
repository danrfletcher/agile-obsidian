import { App } from "obsidian";
import { TaskItem } from "@features/task-index";
import { snoozeTask } from "@features/task-snooze";
import { normalizeSection } from "./ui-policy";

/**
 * Hide a task's LI and collapse empty ancestors/sections afterward.
 * NOTE: Kept exported for compatibility, but not used by the dashboard anymore.
 * We now prefer event-driven re-rendering at the view level instead of DOM-hiding here.
 */
export function hideTaskAndCollapseAncestors(_liEl: HTMLElement): void {
	// Intentionally no-op in the refactored flow
}

// Internal: determine if task has direct assignment to provided userSlug
function isAssignedToUser(text: string, userSlug: string) {
	if (!text || !userSlug) return false;
	const activeRe = new RegExp(`\\bactive-${userSlug}\\b`, "i");
	const inactiveRe = new RegExp(`\\binactive-${userSlug}\\b`, "i");
	return activeRe.test(text) && !inactiveRe.test(text);
}

// Decide if a snooze button should be shown for a task in a given section
function shouldShowSnoozeButton(
	task: TaskItem,
	sectionType: string,
	userSlug: string
): boolean {
	const section = normalizeSection(sectionType);

	// 1) No snooze buttons in Objectives or Responsibilities
	if (section === "objectives" || section === "responsibilities")
		return false;

	// 2) Tasks, Stories, Epics: only on items directly assigned to the user
	if (section === "tasks" || section === "stories" || section === "epics") {
		return isAssignedToUser(task.text || "", userSlug);
	}

	// 3) Initiatives: allow everything
	if (section === "initiatives") return true;

	// 4) Priorities: only leaf tasks
	if (section === "priorities") {
		const isLeaf = !task.children || task.children.length === 0;
		return isLeaf;
	}

	return false;
}

// Build a YYYY-MM-DD string for tomorrow (local)
function getTomorrowISO(): string {
	const d = new Date();
	d.setDate(d.getDate() + 1);
	const yyyy = d.getFullYear();
	const mm = String(d.getMonth() + 1).padStart(2, "0");
	const dd = String(d.getDate()).padStart(2, "0");
	return `${yyyy}-${mm}-${dd}`;
}

// Create and wire the snooze button with click (tomorrow) and long-press (custom date) behavior
function createSnoozeButton(
	task: TaskItem,
	liEl: HTMLElement,
	sectionType: string,
	app: App,
	userSlug: string
): HTMLButtonElement {
	const btn = document.createElement("button");
	btn.type = "button";
	btn.textContent = "💤";
	btn.classList.add("agile-snooze-btn");
	btn.title = "Click: snooze until tomorrow • Long-press: enter custom date";
	btn.style.marginLeft = "8px";
	btn.style.cursor = "pointer";
	btn.style.background = "none";
	btn.style.border = "none";
	btn.style.fontSize = "1em";

	const uid = task._uniqueId || "";
	const filePath = uid.split(":")[0] || "";

	let longPressTimer: number | null = null;
	let longPressed = false;
	const LONG_PRESS_MS = 500;

	const clearTimer = () => {
		if (longPressTimer !== null) {
			window.clearTimeout(longPressTimer);
			longPressTimer = null;
		}
	};

	const showCustomDateInput = () => {
		longPressed = true;
		const input = document.createElement("input");
		input.type = "text";
		input.placeholder = "YYYY-MM-DD";
		input.style.width = "110px";
		input.style.marginLeft = "6px";
		input.style.fontSize = "0.95em";

		const submit = async () => {
			const val = input.value.trim();
			const isValid = /^\d{4}-\d{2}-\d{2}$/.test(val);
			input.remove();
			btn.style.display = "";
			if (!isValid) return;
			btn.textContent = "⏳";
			if (filePath) {
				window.dispatchEvent(
					new CustomEvent("agile:prepare-optimistic-file-change", {
						detail: { filePath },
					})
				);
			}
			try {
				await snoozeTask(task, app, userSlug, val);
				if (uid && filePath) {
					window.dispatchEvent(
						new CustomEvent("agile:task-snoozed", {
							detail: { uid, filePath, date: val },
						})
					);
				}
				// No DOM-hiding; the view re-renders when it catches agile:task-snoozed
			} catch (err) {
				btn.textContent = "💤";
				throw err;
			}
		};

		input.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "Enter") submit();
			if (e.key === "Escape") {
				input.remove();
				btn.style.display = "";
			}
		});
		input.addEventListener("blur", submit);

		btn.style.display = "none";
		liEl.appendChild(input);
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

	// Click to snooze until tomorrow (ignore if this click concluded a long-press)
	btn.addEventListener("click", async (e) => {
		e.preventDefault();
		e.stopPropagation();
		if (longPressed) return;
		btn.textContent = "⏳";
		if (filePath) {
			window.dispatchEvent(
				new CustomEvent("agile:prepare-optimistic-file-change", {
					detail: { filePath },
				})
			);
		}
		try {
			const date = getTomorrowISO();
			await snoozeTask(task, app, userSlug, date);
			if (uid && filePath) {
				window.dispatchEvent(
					new CustomEvent("agile:task-snoozed", {
						detail: { uid, filePath, date },
					})
				);
			}
			// No DOM-hiding; let the dashboard re-render
		} catch (err) {
			btn.textContent = "💤";
			throw err;
		}
	});

	// Mouse long-press
	btn.addEventListener("mousedown", startLongPress);
	btn.addEventListener("mouseup", cancelLongPress);
	btn.addEventListener("mouseleave", cancelLongPress);

	// Touch long-press (mobile)
	btn.addEventListener("touchstart", startLongPress, { passive: true });
	btn.addEventListener("touchend", cancelLongPress);

	return btn;
}

function findInlineAnchor(liEl: HTMLElement): HTMLElement {
	const innerLi = liEl.querySelector("ul > li") as HTMLElement | null;
	const base = innerLi ?? liEl;
	const inlineContainer =
		(base.querySelector("p") as HTMLElement | null) ||
		(base.querySelector("span") as HTMLElement | null) ||
		(base.querySelector("label") as HTMLElement | null);
	return inlineContainer ?? base;
}

export function appendSnoozeButtonIfEligible(
	task: TaskItem,
	liEl: HTMLElement,
	sectionType: string,
	app: App,
	selectedAlias: string | null
) {
	const uid = task._uniqueId || "";
	const filePath = uid.split(":")[0] || "";

	const userSlug = selectedAlias;
	if (!userSlug) {
		return; // No user configured; skip
	}

	const eligible = shouldShowSnoozeButton(task, sectionType, userSlug);
	if (!eligible) {
		return;
	}

	if (uid) liEl.setAttribute("data-task-uid", uid);
	if (filePath) liEl.setAttribute("data-file-path", filePath);

	const btn = createSnoozeButton(task, liEl, sectionType, app, userSlug);
	const anchor = findInlineAnchor(liEl);
	anchor.appendChild(btn);
}
