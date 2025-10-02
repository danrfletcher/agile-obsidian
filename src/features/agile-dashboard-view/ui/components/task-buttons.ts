import { App } from "obsidian";
import { TaskItem } from "@features/task-index";
import { snoozeTask } from "@features/task-snooze";
import { TaskUIPolicy } from "./ui-policy";
import { getAgileArtifactType } from "@features/task-filter";

/**
 * Hide a task's LI and collapse empty ancestors/sections afterward.
 * Kept as-is but slightly annotated; exported for reuse.
 */
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

	// Walk up and collapse single-child ancestors
	let current: HTMLElement | null = liEl;
	while (current) {
		const ul = current.parentElement as HTMLElement | null;
		if (!ul || ul.tagName !== "UL") break;

		const parentLi = ul.parentElement as HTMLElement | null;
		if (!parentLi || parentLi.tagName !== "LI") break;

		const childLis = Array.from(ul.children).filter(
			(n) => n instanceof HTMLElement && n.tagName === "LI"
		) as HTMLElement[];
		const visibleChildren = childLis.filter((li) => isVisible(li));

		if (childLis.length === 1 || visibleChildren.length === 0) {
			hide(parentLi);
			current = parentLi;
			continue;
		}
		break;
	}

	// If no visible tasks remain in the section, hide the section (including its header)
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
			maybeHideAdjacentHeader(sectionRoot);
		}
	}
}

// Convert sectionType to normalized key for policy checks
function normalizeSection(sectionType: string): TaskUIPolicy["section"] {
	const s = (sectionType || "").toLowerCase();
	// Keep an explicit branch for objectives-linked before the generic "objective" match
	if (s.includes("objectives-linked")) return "objectives-linked";
	if (s.includes("objective")) return "objectives";
	if (s.includes("responsibil")) return "responsibilities";
	if (s.includes("priorit")) return "priorities";
	if (s.includes("epic")) return "epics";
	if (s.includes("story")) return "stories";
	if (s.includes("initiative")) return "initiatives";
	return "tasks";
}

function isLeafTask(task: TaskItem): boolean {
	return !task.children || task.children.length === 0;
}

// Decide if a snooze button should be shown for a task in a given section
function shouldShowSnoozeButton(task: TaskItem, sectionType: string): boolean {
	const raw = (sectionType || "").toLowerCase();
	const section = normalizeSection(sectionType);
	const artifact = getAgileArtifactType(task);

	// Objectives – Linked Items: snooze on leaves only
	if (raw.includes("objectives-linked") || section === "objectives-linked") {
		return isLeafTask(task);
	}

	// Objectives: snooze on the Objectives themselves (OKR lines)
	if (section === "objectives") {
		return artifact === "okr";
	}

	// Responsibilities: snooze on the recurring responsibilities themselves
	if (section === "responsibilities") {
		return artifact === "recurring-responsibility";
	}

	// Tasks/Stories/Epics: snooze on bottom-level items (leaves) in their trees
	if (section === "tasks" || section === "stories" || section === "epics") {
		return isLeafTask(task);
	}

	// Initiatives: snooze on everything at every level
	if (section === "initiatives") {
		return true;
	}

	// Priorities (not explicitly requested): keep conservative default – leaves only
	if (section === "priorities") {
		return isLeafTask(task);
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

// Remove any previously added snooze buttons/wrappers in this LI (avoid duplicates on re-render)
function removeExistingSnoozeButtons(liEl: HTMLElement) {
	const existing = liEl.querySelectorAll(
		".agile-snooze-btn, .agile-snooze-btn-wrap"
	);
	existing.forEach((el) => {
		try {
			el.remove();
		} catch {
			/* ignore */
		}
	});
}

// Insert the snooze button reliably at the very end of the task line,
// i.e., after all inline content and before any nested child <ul>.
function placeSnoozeButtonAtLineEnd(liEl: HTMLElement, btn: HTMLButtonElement) {
	// Wrap to enforce inline layout without breaking baseline alignment.
	const wrap = document.createElement("span");
	wrap.classList.add("agile-snooze-btn-wrap");
	wrap.style.display = "inline-block";
	wrap.style.marginLeft = "8px";
	wrap.style.verticalAlign = "baseline";

	// Ensure the button doesn't add extra left margin (wrapper handles spacing)
	btn.style.marginLeft = "0";

	wrap.appendChild(btn);

	// Find the first direct child UL (subtasks list), and insert before it.
	const firstChildList = liEl.querySelector(":scope > ul");
	if (firstChildList) {
		liEl.insertBefore(wrap, firstChildList);
	} else {
		// Otherwise append at the end of the LI, which at this point is the end of the line content.
		liEl.appendChild(wrap);
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
	btn.style.cursor = "pointer";
	btn.style.background = "none";
	btn.style.border = "none";
	btn.style.fontSize = "1em";
	btn.style.verticalAlign = "baseline"; // keep on the same text baseline
	btn.style.marginLeft = "0"; // spacing handled by wrapper

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

		// Make the input replace the snooze button "in place"
		const input = document.createElement("input");
		input.type = "text";
		input.placeholder = "YYYY-MM-DD";
		input.classList.add("agile-snooze-input");
		input.style.width = "120px";
		input.style.display = "inline-block";
		input.style.marginLeft = "8px";
		input.style.fontSize = "0.95em";
		input.style.verticalAlign = "baseline";

		// Replace button with input at the same position
		const parent = btn.parentElement || liEl;
		try {
			btn.replaceWith(input);
		} catch {
			// Fallback if replaceWith not supported
			btn.style.display = "none";
			parent.insertBefore(input, btn.nextSibling);
		}

		const restoreButton = () => {
			// If the LI is still visible (not hidden by snooze), restore the button in-place
			if (input.isConnected) {
				try {
					input.replaceWith(btn);
					btn.style.display = "";
				} catch {
					// Fallback: remove input and show btn
					input.remove();
					btn.style.display = "";
				}
			}
		};

		const submit = async () => {
			const val = input.value.trim();
			const isValid = /^\d{4}-\d{2}-\d{2}$/.test(val);
			if (!isValid) {
				restoreButton();
				return;
			}
			// Show progress on the (soon-to-be-restored) button
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
				// The task will vanish; no need to restore button visually
				hideTaskAndCollapseAncestors(liEl);
			} catch (err) {
				// On error, restore the button and reset icon
				restoreButton();
				btn.textContent = "💤";
				throw err;
			}
		};

		input.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "Enter") submit();
			if (e.key === "Escape") {
				restoreButton();
			}
		});
		input.addEventListener("blur", () => {
			// If blur happens without submit, just restore button
			restoreButton();
		});

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
	btn.addEventListener("touchcancel", cancelLongPress);

	return btn;
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

	// We don’t require selectedAlias for snoozing anymore (per placement rules),
	// but we still need it for snoozeTask attribution; fallback to empty if null.
	const userSlug = selectedAlias || "";

	const eligible = shouldShowSnoozeButton(task, sectionType);
	if (!eligible) {
		// If not eligible, ensure we don't leave around stale buttons from previous renders.
		removeExistingSnoozeButtons(liEl);
		return;
	}

	if (uid) liEl.setAttribute("data-task-uid", uid);
	if (filePath) liEl.setAttribute("data-file-path", filePath);

	// Avoid duplicates on re-render/optimistic updates
	removeExistingSnoozeButtons(liEl);

	const btn = createSnoozeButton(task, liEl, sectionType, app, userSlug);

	// Place the button at the end of the task line, i.e., after all inline content
	// (including assignee templates) but before any nested child UL with subtasks.
	placeSnoozeButtonAtLineEnd(liEl, btn);
}
