import { App } from "obsidian";
import { TaskItem } from "src/domain/tasks/task-item";
import { snoozeTask } from "src/domain/tasks/snooze/snooze";
import { getTeamMemberSlug } from "src/domain/tasks/task-filters"; //TO DO: fix divergent logic - snooze should not have its own getTeamMemberSlug - use slug utils

// Check if task text indicates it's assigned to the current user
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
	userSlug: string,
	liEl?: HTMLElement
): boolean {
	const text = task.text || "";

	// 1) No buttons in Objectives or Responsibilities
	if (sectionType === "objectives" || sectionType === "responsibilities")
		return false;

	// 2) Tasks, Stories, Epics: only on items directly assigned to the user
	if (
		sectionType === "tasks" ||
		sectionType === "stories" ||
		sectionType === "epics"
	) {
		return isAssignedToUser(text, userSlug);
	}

	// 3) Initiatives: buttons on tasks all the way down the tree (allow everything)
	if (sectionType === "initiatives") return true;

	// 4) Priorities: show snooze only on leaf tasks (lowest-level children)
	if (sectionType === "priorities") {
		const isLeaf = !task.children || task.children.length === 0;
		return isLeaf;
	}

	// Default: hide
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

export function hideTaskAndCollapseAncestors(liEl: HTMLElement): void {
	if (!liEl) return;

	const hide = (el: HTMLElement) => {
		el.style.display = "none";
		el.setAttribute("aria-hidden", "true");
	};

	const isVisible = (el: HTMLElement) => {
		if (!el) return false;
		if (el.style.display === "none") return false;
		const cs = getComputedStyle(el);
		if (cs.visibility === "hidden" || cs.display === "none") return false;
		return el.offsetParent !== null;
	};

	// Hide the affected task
	hide(liEl);

	// Walk up: if a parent LI's UL had only this one child (now hidden), hide the parent too
	let current: HTMLElement | null = liEl;
	while (current) {
		const ul = current.parentElement as HTMLElement | null;
		if (!ul || ul.tagName !== "UL") break;

		const parentLi = ul.parentElement as HTMLElement | null;
		if (!parentLi || parentLi.tagName !== "LI") break;

		// Count direct LI children under this UL
		const childLis = Array.from(ul.children).filter(
			(n) => n instanceof HTMLElement && n.tagName === "LI"
		) as HTMLElement[];

		// Visible children after hiding current
		const visibleChildren = childLis.filter((li) => isVisible(li));

		// If parent effectively had only this one child, hide it and continue upward
		if (childLis.length === 1 || visibleChildren.length === 0) {
			hide(parentLi);
			current = parentLi;
			continue;
		}

		break;
	}

	// After collapsing, if no visible tasks remain in the section, hide the section (including its header)
	const findSectionRoot = (el: HTMLElement): HTMLElement | null => {
		let cur: HTMLElement | null = el;
		while (cur && cur.parentElement) {
			const parent = cur.parentElement as HTMLElement;
			if (
				parent.classList &&
				parent.classList.contains("content-container")
			) {
				return cur;
			}
			cur = parent;
		}
		return null;
	};

	const maybeHideAdjacentHeader = (el: HTMLElement) => {
		const prev = el.previousElementSibling as HTMLElement | null;
		if (prev && /^H[1-6]$/.test(prev.tagName)) {
			hide(prev);
		}
	};

	const sectionRoot = findSectionRoot(liEl);
	if (sectionRoot) {
		const visibleLis = Array.from(
			sectionRoot.querySelectorAll("li")
		).filter((node) => isVisible(node as HTMLElement));
		if (visibleLis.length === 0) {
			hide(sectionRoot);
			// If the section root is a list directly under the content container and the header is a sibling,
			// also hide that header so the section disappears completely.
			maybeHideAdjacentHeader(sectionRoot);
		}
	}
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
				hideTaskAndCollapseAncestors(liEl);
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
			hideTaskAndCollapseAncestors(liEl);
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
	// Prefer inner UL>LI if present (result of rendering a single "- [ ]" task line)
	const innerLi = liEl.querySelector("ul > li") as HTMLElement | null;
	const base = innerLi ?? liEl;

	// Prefer inline containers inside base for appending the button at end of text
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
	app: App
) {
	const uid = task._uniqueId || "";
	const filePath = uid.split(":")[0] || "";

	const userSlug = getTeamMemberSlug();
	if (!userSlug) {
		return; // No user configured; skip
	}

	const eligible = shouldShowSnoozeButton(task, sectionType, userSlug, liEl);
	if (!eligible) {
		return;
	}

	if (uid) liEl.setAttribute("data-task-uid", uid);
	if (filePath) liEl.setAttribute("data-file-path", filePath);

	const btn = createSnoozeButton(task, liEl, sectionType, app, userSlug);
	const anchor = findInlineAnchor(liEl);
	anchor.appendChild(btn);
}
