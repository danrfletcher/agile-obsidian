import { App, Component, MarkdownRenderer, TFile } from "obsidian";
import { TaskItem } from "@features/task-index";
import {
	appendSnoozeButtonIfEligible,
	appendSnoozeAllSubtasksButtonIfEligible,
} from "./task-buttons";
import { handleStatusChange } from "../../app/status-update";
import { normalizeSection as normalizeSectionPolicy } from "./ui-policy";
import { eventBus } from "../../app/event-bus";

function isLeaf(task: TaskItem): boolean {
	return !task.children || task.children.length === 0;
}

function normalizeSection(sectionType: string) {
	return normalizeSectionPolicy(sectionType);
}

function shouldEnableCheckbox(
	sectionType: string,
	depth: number,
	task: TaskItem,
	isRoot: boolean
): boolean {
	const section = normalizeSection(sectionType);
	const leaf = isLeaf(task);

	if (section === "initiatives") return true;
	if (section === "objectives" || section === "objectives-linked")
		return (isRoot && depth === 0) || leaf;
	if (
		section === "tasks" ||
		section === "stories" ||
		section === "epics" ||
		section === "priorities" ||
		section === "responsibilities"
	) {
		return leaf;
	}
	return true;
}

let assignmentEventListenerAttached = false;
function ensureAssignmentEventListener(app: App) {
	if (assignmentEventListenerAttached) return;
	assignmentEventListenerAttached = true;

	eventBus.on(
		"agile:request-assign-propagate",
		async (detail) => {
			try {
				const uid = detail?.uid;
				const newAlias = detail?.newAlias;
				if (
					typeof uid === "string" &&
					typeof newAlias === "string" &&
					uid
				) {
					const filePath = uid.split(":")[0] || "";
					if (filePath) {
						eventBus.dispatch(
							"agile:prepare-optimistic-file-change",
							{ filePath }
						);
						eventBus.dispatch("agile:assignment-changed", {
							uid,
							filePath,
							newAlias,
						});
					}
				}
			} catch {
				/* ignore */
			}
		}
	);
}

function annotateAssigneeMarks(
	liEl: HTMLElement,
	uid: string,
	filePath: string
) {
	const marks = liEl.querySelectorAll("mark");
	marks.forEach((m) => {
		const el = m as HTMLElement;
		const cls = (el.getAttribute("class") || "").toLowerCase();
		if (
			!/(^|\s)(?:active|inactive)-[a-z0-9-]+(\s|$)/i.test(" " + cls + " ")
		)
			return;
		const strong = el.querySelector("strong");
		if (!strong || !/^\s*👋/u.test(strong.textContent || "")) return;
		el.setAttribute("data-task-uid", uid);
		if (filePath) el.setAttribute("data-file-path", filePath);
	});
}

/**
 * Utilities for opening a task's source file at its line in a new tab (leaf)
 */
function getTaskFilePath(task: TaskItem): string {
	return task.link?.path || (task._uniqueId?.split(":")[0] ?? "");
}

function getTaskLine(task: TaskItem): number | null {
	const posLine = (task as any)?.position?.start?.line ?? (task as any)?.line;
	if (typeof posLine === "number" && posLine >= 0) return posLine;
	if (typeof task.line === "number" && task.line >= 0) return task.line;
	return null;
}

async function openTaskInNewTab(app: App, task: TaskItem): Promise<void> {
	try {
		const filePath = getTaskFilePath(task);
		if (!filePath) return;

		const abs = app.vault.getAbstractFileByPath(filePath);
		if (!(abs instanceof TFile)) return;

		const line = getTaskLine(task);
		const leaf = app.workspace.getLeaf(true);

		await (leaf as any).openFile(abs, {
			eState: line != null ? { line } : {},
		});

		try {
			const view = (leaf as any).view;
			if (
				view?.editor &&
				typeof view.editor.setCursor === "function" &&
				line != null
			) {
				view.editor.setCursor({ line, ch: 0 });
				if (typeof view.editor.scrollIntoView === "function") {
					view.editor.scrollIntoView(
						{ from: { line, ch: 0 }, to: { line, ch: 0 } },
						true
					);
				}
			} else if (
				typeof view?.setEphemeralState === "function" &&
				line != null
			) {
				view.setEphemeralState({ line });
			}
		} catch {
			/* ignore */
		}

		if (line == null && (task as any).blockId) {
			const blockId = (task as any).blockId;
			try {
				(app.workspace as any).openLinkText(
					`${filePath}#^${blockId}`,
					"",
					true
				);
			} catch {
				/* ignore */
			}
		}
	} catch {
		/* ignore */
	}
}

/**
 * Attach a long-press handler to the task's LI to open source in new tab.
 */
function attachOpenOnLongPress(
	liEl: HTMLElement,
	task: TaskItem,
	app: App
): void {
	if ((liEl as any).__agileOpenAttached) return;

	const LONG_PRESS_MS = 500;
	let pressTimer: number | null = null;

	const clearTimer = () => {
		if (pressTimer !== null) {
			window.clearTimeout(pressTimer);
			pressTimer = null;
		}
	};

	const isInteractiveTarget = (el: HTMLElement | null): boolean => {
		if (!el) return false;
		if (el.closest("input, button, a, .agile-snooze-btn")) return true;
		if (el.closest("label")) return true;
		return false;
	};

	const onPressStart = (ev: Event) => {
		const target = ev.target as HTMLElement | null;
		if (isInteractiveTarget(target)) return;
		clearTimer();
		pressTimer = window.setTimeout(async () => {
			await openTaskInNewTab(app, task);
			clearTimer();
		}, LONG_PRESS_MS);
	};

	const onPressEnd = () => {
		clearTimer();
	};

	liEl.addEventListener("mousedown", onPressStart);
	liEl.addEventListener("mouseup", onPressEnd);
	liEl.addEventListener("mouseleave", onPressEnd);

	liEl.addEventListener("touchstart", onPressStart, { passive: true } as any);
	liEl.addEventListener("touchend", onPressEnd);
	liEl.addEventListener("touchcancel", onPressEnd);

	(liEl as any).__agileOpenAttached = true;
}

/**
 * Render a tree of tasks into the given container.
 */
export function renderTaskTree(
	tasks: TaskItem[],
	container: HTMLElement,
	app: App,
	depth: number,
	isRoot: boolean,
	sectionType: string,
	selectedAlias: string | null
) {
	ensureAssignmentEventListener(app);
	if (tasks.length === 0) return;

	const normalizedSection = normalizeSection(sectionType);
	const taskList = container.createEl("ul", {
		cls: "agile-dashboard contains-task-list",
	});
	taskList.setAttribute("data-section", normalizedSection);

	tasks.forEach((task) => {
		if (
			!task.text?.trim() &&
			!task.visual?.trim() &&
			(!task.children || task.children.length === 0)
		)
			return;

		const tempEl = document.createElement("div");
		const renderComponent = new Component();
		MarkdownRenderer.renderMarkdown(
			(task.visual || task.text || "").trim(),
			tempEl,
			task.link?.path || "",
			renderComponent
		);
		renderComponent.load();

		const firstEl = tempEl.firstElementChild as HTMLElement | null;
		let taskItemEl: HTMLElement;

		if (firstEl?.tagName.toLowerCase() === "ul") {
			if (
				firstEl.children.length === 1 &&
				(
					firstEl.firstElementChild as HTMLElement | null
				)?.tagName.toLowerCase() === "li"
			) {
				taskItemEl = firstEl.firstElementChild as HTMLElement;
				taskList.appendChild(taskItemEl);
			} else {
				taskItemEl = taskList.createEl("li", { cls: "task-list-item" });
				while (tempEl.firstChild) {
					taskItemEl.appendChild(tempEl.firstChild);
				}
			}
		} else {
			taskItemEl = taskList.createEl("li", { cls: "task-list-item" });
			while (tempEl.firstChild) {
				taskItemEl.appendChild(tempEl.firstChild);
			}
		}

		if (task.annotated) {
			taskItemEl.addClass("annotated-task");
		}

		if (task._uniqueId) {
			taskItemEl.setAttribute("data-task-uid", task._uniqueId);
		}
		const filePath = task.link?.path || "";
		if (filePath) {
			taskItemEl.setAttribute("data-file-path", filePath);
		}
		const line = getTaskLine(task);
		if (line != null) {
			taskItemEl.setAttribute("data-line", String(line));
		}

		try {
			annotateAssigneeMarks(taskItemEl, task._uniqueId || "", filePath);
		} catch {
			/* ignore */
		}

		try {
			appendSnoozeButtonIfEligible(
				task,
				taskItemEl,
				sectionType,
				app,
				selectedAlias
			);
			appendSnoozeAllSubtasksButtonIfEligible(
				task,
				taskItemEl,
				sectionType,
				app,
				selectedAlias
			);
		} catch {
			/* ignore */
		}

		try {
			attachOpenOnLongPress(taskItemEl, task, app);
		} catch {
			/* ignore */
		}

		const checkbox = taskItemEl.querySelector(
			'input[type="checkbox"]'
		) as HTMLInputElement | null;
		if (checkbox) {
			const interactive = shouldEnableCheckbox(
				sectionType,
				depth,
				task,
				isRoot
			);
			if (!interactive) {
				checkbox.disabled = true;
				checkbox.tabIndex = -1;
				checkbox.setAttribute("aria-disabled", "true");
				(checkbox as HTMLElement).style.pointerEvents = "none";
			} else {
				let pressTimer: number | null = null;
				let longPressed = false;
				const LONG_PRESS_MS = 500;

				let initialChecked = checkbox.checked;
				let isUpdating = false;

				const performUpdate = async (cancel: boolean) => {
					if (isUpdating) return;
					isUpdating = true;
					try {
						const result = await handleStatusChange(
							task,
							taskItemEl,
							app,
							cancel
						);
						if (result === "/") {
							rerenderTaskInline(
								task,
								taskItemEl,
								app,
								sectionType,
								result,
								isRoot,
								depth,
								selectedAlias
							);
						} else if (result === "x") {
							checkbox.checked = true;
							initialChecked = true;
						}
					} finally {
						isUpdating = false;
					}
				};

				checkbox.addEventListener("change", (ev) => {
					ev.preventDefault();
					// @ts-ignore
					ev.stopImmediatePropagation?.();
					checkbox.checked = initialChecked;
				});

				checkbox.addEventListener("keydown", async (ev) => {
					const key = (ev as KeyboardEvent).key;
					if (key === " " || key === "Enter") {
						ev.preventDefault();
						await performUpdate(false);
					}
				});

				const clearTimer = () => {
					if (pressTimer !== null) {
						window.clearTimeout(pressTimer);
						pressTimer = null;
					}
				};

				const onPressStart = () => {
					longPressed = false;
					clearTimer();
					pressTimer = window.setTimeout(async () => {
						longPressed = true;
						await performUpdate(true);
					}, LONG_PRESS_MS);
				};

				const onPressEnd = () => {
					clearTimer();
				};

				checkbox.addEventListener("mousedown", onPressStart);
				checkbox.addEventListener("touchstart", onPressStart, {
					passive: true,
				});
				checkbox.addEventListener("mouseup", onPressEnd);
				checkbox.addEventListener("mouseleave", onPressEnd);
				checkbox.addEventListener("touchend", onPressEnd);
				checkbox.addEventListener("touchcancel", onPressEnd);

				checkbox.addEventListener("click", async (ev) => {
					ev.preventDefault();
					ev.stopPropagation();
					if (longPressed) {
						longPressed = false;
						return;
					}
					await performUpdate(false);
				});
			}
		}

		if (task.children && task.children.length > 0) {
			renderTaskTree(
				task.children,
				taskItemEl,
				app,
				depth + 1,
				false,
				sectionType,
				selectedAlias
			);
		}
	});
}

function rerenderTaskInline(
	task: TaskItem,
	liEl: HTMLElement,
	app: App,
	sectionType: string,
	newStatus: string,
	isRoot: boolean,
	depth: number,
	selectedAlias: string | null
): void {
	try {
		const childLists = Array.from(
			liEl.querySelectorAll(":scope > ul")
		) as HTMLElement[];

		let lineMd = (task.visual || task.text || "").trim();

		if (/^\s*[-*]\s*\[\s*.\s*\]/.test(lineMd)) {
			lineMd = lineMd.replace(
				/^(\s*[-*]\s*\[\s*)(.)(\s*\])/,
				`$1${newStatus}$3`
			);
		} else {
			lineMd = `- [${newStatus}] ${lineMd}`;
		}

		if (newStatus === "/") {
			lineMd = lineMd
				.replace(/\s*(✅|❌)\s+\d{4}-\d{2}-\d{2}\b/g, "")
				.trimEnd();
		}

		liEl.innerHTML = "";

		const tempEl = document.createElement("div");
		const renderComponent = new Component();
		MarkdownRenderer.renderMarkdown(
			lineMd,
			tempEl,
			task.link?.path || "",
			renderComponent
		);
		renderComponent.load();

		const firstEl = tempEl.firstElementChild as HTMLElement | null;
		if (
			firstEl?.tagName.toLowerCase() === "ul" &&
			firstEl.children.length === 1 &&
			(
				firstEl.firstElementChild as HTMLElement | null
			)?.tagName.toLowerCase() === "li"
		) {
			const sourceLi = firstEl.firstElementChild as HTMLElement;
			const hadAnnotated = liEl.classList.contains("annotated-task");

			const dataTask = sourceLi.getAttribute("data-task");
			if (dataTask !== null) liEl.setAttribute("data-task", dataTask);
			else liEl.removeAttribute("data-task");

			const role = sourceLi.getAttribute("role");
			if (role !== null) liEl.setAttribute("role", role);
			else liEl.removeAttribute("role");

			const ariaChecked = sourceLi.getAttribute("aria-checked");
			if (ariaChecked !== null)
				liEl.setAttribute("aria-checked", ariaChecked);
			else liEl.removeAttribute("aria-checked");

			liEl.className = sourceLi.className;
			if (hadAnnotated) liEl.classList.add("annotated-task");

			while (sourceLi.firstChild) {
				liEl.appendChild(sourceLi.firstChild);
			}
		} else {
			while (tempEl.firstChild) {
				liEl.appendChild(tempEl.firstChild);
			}
			liEl.classList.add("task-list-item");
			if (newStatus === "x") liEl.classList.add("is-checked");
			else liEl.classList.remove("is-checked");
			liEl.setAttribute("data-task", newStatus);
		}

		const inputEl = liEl.querySelector(
			'input[type="checkbox"]'
		) as HTMLInputElement | null;
		if (inputEl) {
			inputEl.setAttribute("data-task", newStatus);
		}

		childLists.forEach((ul) => liEl.appendChild(ul));

		try {
			appendSnoozeButtonIfEligible(
				task,
				liEl,
				sectionType,
				app,
				selectedAlias
			);
			appendSnoozeAllSubtasksButtonIfEligible(
				task,
				liEl,
				sectionType,
				app,
				selectedAlias
			);
		} catch {
			/* ignore */
		}

		try {
			attachOpenOnLongPress(liEl, task, app);
		} catch {
			/* ignore */
		}

		const checkbox = liEl.querySelector(
			'input[type="checkbox"]'
		) as HTMLInputElement | null;

		if (checkbox) {
			const interactive = shouldEnableCheckbox(
				sectionType,
				depth,
				task,
				isRoot
			);
			if (!interactive) {
				checkbox.disabled = true;
				checkbox.tabIndex = -1;
				checkbox.setAttribute("aria-disabled", "true");
				(checkbox as HTMLElement).style.pointerEvents = "none";
			} else {
				let pressTimer: number | null = null;
				const LONG_PRESS_MS = 500;

				let initialChecked = checkbox.checked;
				let isUpdating = false;

				const performUpdate = async (cancel: boolean) => {
					if (isUpdating) return;
					isUpdating = true;
					try {
						const result = await handleStatusChange(
							task,
							liEl,
							app,
							cancel
						);
						if (result === "/") {
							rerenderTaskInline(
								task,
								liEl,
								app,
								sectionType,
								result,
								isRoot,
								depth,
								selectedAlias
							);
						} else if (result === "x") {
							checkbox.checked = true;
							initialChecked = true;
						}
					} finally {
						isUpdating = false;
					}
				};

				checkbox.addEventListener("change", (ev) => {
					ev.preventDefault();
					// @ts-ignore
					ev.stopImmediatePropagation?.();
					checkbox.checked = initialChecked;
				});

				checkbox.addEventListener("keydown", async (ev) => {
					const key = (ev as KeyboardEvent).key;
					if (key === " " || key === "Enter") {
						ev.preventDefault();
						await performUpdate(false);
					}
				});

				const clearTimer = () => {
					if (pressTimer !== null) {
						window.clearTimeout(pressTimer);
						pressTimer = null;
					}
				};

				const onPressStart = () => {
					clearTimer();
					pressTimer = window.setTimeout(async () => {
						await performUpdate(true);
					}, LONG_PRESS_MS);
				};

				const onPressEnd = () => {
					clearTimer();
				};

				checkbox.addEventListener("mousedown", onPressStart);
				checkbox.addEventListener("touchstart", onPressStart, {
					passive: true,
				});
				checkbox.addEventListener("mouseup", onPressEnd);
				checkbox.addEventListener("mouseleave", onPressEnd);
				checkbox.addEventListener("touchend", onPressEnd);
				checkbox.addEventListener("touchcancel", onPressEnd);

				checkbox.addEventListener("click", async (ev) => {
					ev.preventDefault();
					ev.stopPropagation();
					await performUpdate(false);
				});
			}
		}
	} catch {
		// no-op
	}
}
