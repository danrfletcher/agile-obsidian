import { App } from "obsidian";
import { TaskItem } from "../types/TaskItem";
import { snoozeTask, getTeamMemberSlug } from "../utils/snooze";

// Simple helpers to detect task types by emoji markers
function isInitiative(text: string) {
  return typeof text === "string" && text.includes("🎖️");
}
function isEpic(text: string) {
  return typeof text === "string" && text.includes("🏆");
}
function isStory(text: string) {
  return typeof text === "string" && text.includes("📝");
}
function isOKR(text: string) {
  return typeof text === "string" && text.includes("🎯");
}

// Check if task text indicates it's assigned to the current user
function isAssignedToUser(text: string, userSlug: string) {
  if (!text || !userSlug) return false;
  const activeRe = new RegExp(`\\bactive-${userSlug}\\b`, "i");
  const inactiveRe = new RegExp(`\\binactive-${userSlug}\\b`, "i");
  return activeRe.test(text) && !inactiveRe.test(text);
}

// Decide if a snooze button should be shown for a task in a given section
function shouldShowSnoozeButton(task: TaskItem, sectionType: string, userSlug: string): boolean {
  const text = task.text || "";

  // 1) No buttons in Objectives or Responsibilities
  if (sectionType === "objectives" || sectionType === "responsibilities") return false;

  // 2) Tasks, Stories, Epics: only on items directly assigned to the user
  if (sectionType === "tasks" || sectionType === "stories" || sectionType === "epics") {
    return isAssignedToUser(text, userSlug);
  }

  // 3) Initiatives: on initiatives & epics
  if (sectionType === "initiatives") {
    return isInitiative(text) || isEpic(text);
  }

  // 4) Priorities: buttons on tasks all the way down the tree (allow everything)
  if (sectionType === "priorities") return true;

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

// Create and wire the snooze button with click (tomorrow) and long-press (custom date) behavior
function createSnoozeButton(
  task: TaskItem,
  liEl: HTMLElement,
  sectionType: string,
  app: App,
  userSlug: string
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.textContent = "💤";
  btn.classList.add("agile-snooze-btn");
  btn.title = "Click: snooze until tomorrow • Long-press: enter custom date";
  btn.style.marginLeft = "8px";
  btn.style.cursor = "pointer";
  btn.style.background = "none";
  btn.style.border = "none";
  btn.style.fontSize = "1em";

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
      try {
        await snoozeTask(task, app, userSlug, val);
      } finally {
        // Leave hourglass; UI will refresh on file modify event if the view listens to it
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
    e.stopPropagation();
    if (longPressed) return;
    btn.textContent = "⏳";
    try {
      await snoozeTask(task, app, userSlug, getTomorrowISO());
    } finally {
      // Keep hourglass; view should re-render after file modify
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
  const userSlug = getTeamMemberSlug();
  if (!userSlug) return; // No user configured; skip
  if (!shouldShowSnoozeButton(task, sectionType, userSlug)) return;

  const btn = createSnoozeButton(task, liEl, sectionType, app, userSlug);
  const anchor = findInlineAnchor(liEl);
  anchor.appendChild(btn);
}
