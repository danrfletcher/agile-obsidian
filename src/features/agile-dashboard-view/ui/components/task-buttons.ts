import { App } from "obsidian";
import { TaskItem } from "@features/task-index";
import { snoozeTask } from "@features/task-snooze";
import {
	TaskUIPolicy,
	normalizeSection as normalizeSectionPolicy,
} from "./ui-policy";
import { getAgileArtifactType } from "@features/task-filter";
import { eventBus } from "../../app/event-bus";

/**
 * Hide a task's LI and collapse empty ancestors/sections afterward.
 * NOTE: Kept exported for compatibility, but not used by the dashboard anymore.
 * We now prefer event-driven re-rendering at the view level instead of DOM-hiding here.
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
			if (parent.classList?.contains("content-container")) {
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
	return normalizeSectionPolicy(sectionType);
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

	// Priorities: conservative default – leaves only
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

// Insert the button reliably at the very end of the task line,
// i.e., after all inline content and before any nested child <ul>.
function placeSnoozeButtonAtLineEnd(liEl: HTMLElement, btn: HTMLButtonElement) {
	const wrap = document.createElement("span");
	wrap.classList.add("agile-snooze-btn-wrap");
	wrap.style.display = "inline-block";
	wrap.style.marginLeft = "8px";
	wrap.style.verticalAlign = "baseline";

	btn.style.marginLeft = "0";
	wrap.appendChild(btn);

	const firstChildList = liEl.querySelector(":scope > ul");
	if (firstChildList) {
		liEl.insertBefore(wrap, firstChildList);
	} else {
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
	btn.style.verticalAlign = "baseline";
	btn.style.marginLeft = "0";

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
		input.classList.add("agile-snooze-input");
		input.style.width = "120px";
		input.style.display = "inline-block";
		input.style.marginLeft = "8px";
		input.style.fontSize = "0.95em";
		input.style.verticalAlign = "baseline";

		const parent = btn.parentElement || liEl;
		try {
			btn.replaceWith(input);
		} catch {
			btn.style.display = "none";
			parent.insertBefore(input, btn.nextSibling);
		}

		const restoreButton = () => {
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

		const submit = async () => {
			const val = input.value.trim();
			const isValid = /^\d{4}-\d{2}-\d{2}$/.test(val);
			if (!isValid) {
				restoreButton();
				return;
			}
			btn.textContent = "⏳";

			if (filePath) {
				eventBus.dispatch("agile:prepare-optimistic-file-change", {
					filePath,
				});
			}
			try {
				await snoozeTask(task, app, userSlug, val);
				if (uid && filePath) {
					eventBus.dispatch("agile:task-snoozed", {
						uid,
						filePath,
						date: val,
					});
				}
				// No DOM-hiding; the view re-renders when it catches agile:task-snoozed
			} catch (err) {
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

	btn.addEventListener("click", async (e) => {
		e.preventDefault();
		e.stopPropagation();
		if (longPressed) return;
		btn.textContent = "⏳";
		if (filePath) {
			eventBus.dispatch("agile:prepare-optimistic-file-change", {
				filePath,
			});
		}
		try {
			const date = getTomorrowISO();
			await snoozeTask(task, app, userSlug, date);
			if (uid && filePath) {
				eventBus.dispatch("agile:task-snoozed", {
					uid,
					filePath,
					date,
				});
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
	btn.addEventListener("touchcancel", cancelLongPress);

	return btn;
}

/**
 * Create and wire the "Snooze All Subtasks" button (💤⬇️).
 */
function createSnoozeAllButton(
	task: TaskItem,
	liEl: HTMLElement,
	app: App,
	userSlug: string
): HTMLButtonElement {
	const btn = document.createElement("button");
	btn.type = "button";
	btn.textContent = "💤⬇️";
	btn.classList.add("agile-snooze-btn", "agile-snooze-all-btn");
	btn.title =
		"Click: snooze all subtasks until tomorrow • Long-press: enter custom date";
	btn.style.cursor = "pointer";
	btn.style.background = "none";
	btn.style.border = "none";
	btn.style.fontSize = "1em";
	btn.style.verticalAlign = "baseline";
	btn.style.marginLeft = "0";

	const uid = task._uniqueId || "";
	const filePath = uid.split(":")[0] || "";

	const optimisticallyHideChildren = () => {
		try {
			const directWraps = Array.from(
				liEl.querySelectorAll(
					":scope > ul, :scope > div.agile-children-collapse"
				)
			) as HTMLElement[];
			directWraps.forEach((wrap) => {
				wrap.style.display = "none";
				wrap.setAttribute("aria-hidden", "true");
			});

			liEl.setAttribute("data-children-expanded", "false");
			const hit = liEl.querySelector(
				'span[data-epic-toggle-hit="true"]'
			) as HTMLElement | null;
			if (hit) hit.setAttribute("aria-expanded", "false");
			const chev = liEl.querySelector(
				'span[data-epic-toggle="true"]'
			) as HTMLElement | null;
			if (chev) chev.style.transform = "rotate(0deg)";
		} catch {
			/* ignore */
		}
	};

	const performSnoozeAll = async (dateStr: string) => {
		if (filePath) {
			eventBus.dispatch("agile:prepare-optimistic-file-change", {
				filePath,
			});
		}
		await snoozeAllSubtasks(task, app, userSlug, dateStr);
		optimisticallyHideChildren();

		if (uid && filePath) {
			eventBus.dispatch("agile:task-snoozed", {
				uid,
				filePath,
				date: dateStr,
			});
		}

		try {
			hideTaskAndCollapseAncestors(liEl);
		} catch {
			/* ignore */
		}
	};

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
		input.classList.add("agile-snooze-input");
		input.style.width = "120px";
		input.style.display = "inline-block";
		input.style.marginLeft = "8px";
		input.style.fontSize = "0.95em";
		input.style.verticalAlign = "baseline";

		const parent = btn.parentElement || liEl;
		try {
			btn.replaceWith(input);
		} catch {
			btn.style.display = "none";
			parent.insertBefore(input, btn.nextSibling);
		}

		const restoreButton = () => {
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

		const submit = async () => {
			const val = input.value.trim();
			const isValid = /^\d{4}-\d{2}-\d{2}$/.test(val);
			if (!isValid) {
				restoreButton();
				return;
			}
			btn.textContent = "⏳";
			try {
				await performSnoozeAll(val);
			} catch (err) {
				btn.textContent = "💤⬇️";
				restoreButton();
				throw err;
			}
			btn.textContent = "💤⬇️";
			restoreButton();
		};

		input.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "Enter") submit();
			if (e.key === "Escape") restoreButton();
		});
		input.addEventListener("blur", () => restoreButton());

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
			await performSnoozeAll(getTomorrowISO());
		} catch (err) {
			btn.textContent = "💤⬇️";
			throw err;
		}
		btn.textContent = "💤⬇️";
	});

	btn.addEventListener("mousedown", startLongPress);
	btn.addEventListener("mouseup", cancelLongPress);
	btn.addEventListener("mouseleave", cancelLongPress);
	btn.addEventListener("touchstart", startLongPress, { passive: true });
	btn.addEventListener("touchend", cancelLongPress);
	btn.addEventListener("touchcancel", cancelLongPress);

	return btn;
}

// Decide if a "Snooze All Subtasks" button should be shown
function shouldShowSnoozeAllButton(
	task: TaskItem,
	sectionType: string
): boolean {
	const section = normalizeSection(sectionType);
	if (section === "objectives") return false;

	const children = task.children || [];
	if (children.length < 2) return false;

	const eligibleChildren = children.filter((child) =>
		shouldShowSnoozeButton(child, sectionType)
	);
	return eligibleChildren.length >= 2;
}

/**
 * Replace or append a '💤⬇️' snooze marker for the current user on the task line.
 * - Removes duplicate user-specific inherited snooze markers.
 * - If a global inherited snooze ('💤⬇️ YYYY-MM-DD') is expired, replaces it with the user-specific one.
 */
async function snoozeAllSubtasks(
	task: TaskItem,
	app: App,
	userSlug: string,
	dateStr: string
): Promise<void> {
	const uid = task._uniqueId || "";
	const filePath = task.link?.path || uid.split(":")[0] || "";
	if (!filePath) throw new Error("Missing file path for task");

	const file = app.vault.getAbstractFileByPath(filePath);
	if (!file) throw new Error(`File not found: ${filePath}`);

	const content = await app.vault.read(file as any);
	const lines = content.split(/\r?\n/);

	const normalize = (s: string) =>
		(s || "")
			.replace(/\s*(✅|❌)\s+\d{4}-\d{2}-\d{2}\b/g, "")
			.replace(/\s+/g, " ")
			.trim();

	const getLineRestNormalized = (line: string): string | null => {
		const m = line.match(/^\s*[-*]\s*\[\s*.\s*\]\s*(.*)$/);
		return m ? normalize(m[1]) : null;
	};

	const targetTextNorm = normalize((task.text || task.visual || "").trim());

	let targetLineIndex = -1;
	const baseIdx =
		typeof (task as any)?.position?.start?.line === "number"
			? (task as any)?.position?.start?.line
			: typeof task.line === "number"
			? task.line
			: -1;

	const candidates = [baseIdx, baseIdx - 1, baseIdx + 1].filter(
		(i) => i >= 0 && i < lines.length
	);
	for (const i of candidates) {
		const rest = getLineRestNormalized(lines[i]);
		if (!rest) continue;
		if (
			rest === targetTextNorm ||
			rest.startsWith(targetTextNorm) ||
			targetTextNorm.startsWith(rest)
		) {
			targetLineIndex = i;
			break;
		}
	}
	if (targetLineIndex === -1 && targetTextNorm) {
		for (let i = 0; i < lines.length; i++) {
			const rest = getLineRestNormalized(lines[i]);
			if (rest && rest === targetTextNorm) {
				targetLineIndex = i;
				break;
			}
		}
		if (targetLineIndex === -1) {
			for (let i = 0; i < lines.length; i++) {
				const rest = getLineRestNormalized(lines[i]);
				if (rest && rest.startsWith(targetTextNorm)) {
					targetLineIndex = i;
					break;
				}
			}
		}
	}

	if (targetLineIndex < 0) {
		throw new Error("Unable to locate task line for snooze-all");
	}

	const today = new Date();
	today.setHours(0, 0, 0, 0);

	const userSpan = `<span style="display: none">${userSlug}</span>`;
	const userMarkerRegex = new RegExp(
		String.raw`💤⬇️\s*<span[^>]*>\s*${escapeForRegex(
			userSlug
		)}\s*<\/span>\s*(\d{4}-\d{2}-\d{2})?`,
		"g"
	);
	const globalInheritedRegex = /💤⬇️\s*(\d{4}-\d{2}-\d{2})(?!\s*<span)/g;

	let line = lines[targetLineIndex];

	line = line.replace(userMarkerRegex, "").trimRight();

	line = line.replace(globalInheritedRegex, (match, date) => {
		const d = parseISO(date);
		if (d && d.getTime() > today.getTime()) {
			return match;
		}
		return `💤⬇️${userSpan} ${dateStr}`;
	});

	if (!/\s$/.test(line)) line += " ";
	line += `💤⬇️${userSpan} ${dateStr}`;

	lines[targetLineIndex] = line;
	const newContent = lines.join("\n");
	if (newContent !== content) {
		await app.vault.modify(file as any, newContent);
	}
}

function escapeForRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseISO(s: string): Date | null {
	const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!m) return null;
	const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
	if (isNaN(d.getTime())) return null;
	d.setHours(0, 0, 0, 0);
	return d;
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
	const userSlug = selectedAlias || "";

	const eligible = shouldShowSnoozeButton(task, sectionType);
	if (!eligible) {
		removeExistingSnoozeButtons(liEl);
		return;
	}

	if (uid) liEl.setAttribute("data-task-uid", uid);
	if (filePath) liEl.setAttribute("data-file-path", filePath);

	removeExistingSnoozeButtons(liEl);
	const btn = createSnoozeButton(task, liEl, sectionType, app, userSlug);
	placeSnoozeButtonAtLineEnd(liEl, btn);
}

/**
 * Append "Snooze All Subtasks" button if eligible for this task and section.
 */
export function appendSnoozeAllSubtasksButtonIfEligible(
	task: TaskItem,
	liEl: HTMLElement,
	sectionType: string,
	app: App,
	selectedAlias: string | null
) {
	const uid = task._uniqueId || "";
	const filePath = uid.split(":")[0] || "";

	const userSlug = selectedAlias || "";
	const eligibleAll = shouldShowSnoozeAllButton(task, sectionType);
	if (!eligibleAll) return;

	if (uid) liEl.setAttribute("data-task-uid", uid);
	if (filePath) liEl.setAttribute("data-file-path", filePath);

	const btnAll = createSnoozeAllButton(task, liEl, app, userSlug);
	placeSnoozeButtonAtLineEnd(liEl, btnAll);
}
