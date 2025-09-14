import { App, Component, MarkdownRenderer } from "obsidian";
import { TaskItem } from "@features/task-index";
import {
	appendSnoozeButtonIfEligible,
} from "./task-buttons";
import { handleStatusChange } from "../../app/status-update";

function isLeaf(task: TaskItem): boolean {
	return !task.children || task.children.length === 0;
}

function normalizeSection(sectionType: string) {
	const s = (sectionType || "").toLowerCase();
	if (s.includes("initiative")) return "initiatives";
	if (s.includes("objective")) return "objectives";
	if (s.includes("task")) return "tasks";
	if (s.includes("story")) return "stories";
	if (s.includes("epic")) return "epics";
	if (s.includes("priorit")) return "priorities";
	if (s.includes("responsibil")) return "responsibilities";
	return "tasks";
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
	if (section === "objectives") return (isRoot && depth === 0) || leaf;
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

	window.addEventListener(
		"agile:request-assign-propagate" as any,
		async (ev: Event) => {
			try {
				const ce = ev as CustomEvent<any>;
				const detail =
					ce && typeof ce.detail === "object" ? ce.detail : {};
				const uid = detail?.uid;
				const newAlias = detail?.newAlias;
				if (
					typeof uid === "string" &&
					typeof newAlias === "string" &&
					uid
				) {
					const filePath = uid.split(":")[0] || "";
					if (filePath) {
						window.dispatchEvent(
							new CustomEvent(
								"agile:prepare-optimistic-file-change",
								{
									detail: { filePath },
								}
							)
						);
					}
					// await updateAssigneeAndPropagate(app, uid, newAlias); // future: assignment cascade
					if (filePath) {
						window.dispatchEvent(
							new CustomEvent("agile:assignment-changed", {
								detail: { uid, filePath, newAlias },
							})
						);
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
 * Render a tree of tasks into the given container.
 * Adds affordances (checkbox semantics, snooze buttons) and wires mutation handlers.
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

	const taskList = container.createEl("ul", {
		cls: "agile-dashboard contains-task-list",
	});

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
