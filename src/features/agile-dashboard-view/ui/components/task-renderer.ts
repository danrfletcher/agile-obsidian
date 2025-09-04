import { App, Component, MarkdownRenderer, TFile } from "obsidian";
import { TaskItem } from "@features/task-index";
import {
	appendSnoozeButtonIfEligible,
	hideTaskAndCollapseAncestors,
} from "./task-buttons";

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
					// await updateAssigneeAndPropagate(app, uid, newAlias); TO DO: add new reassignment/assignment cascade
					if (filePath) {
						window.dispatchEvent(
							new CustomEvent("agile:assignment-changed", {
								detail: { uid, filePath, newAlias },
							})
						);
					}
				}
			} catch (err) {
				console.error(
					"[agile] Failed handling 'agile:request-assign-propagate' event",
					err
				);
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
		} catch (e) {
			console.error("[agile] annotateAssigneeMarks failed", {
				error: e,
				taskUid: task._uniqueId,
				filePath,
			});
		}

		try {
			appendSnoozeButtonIfEligible(
				task,
				taskItemEl,
				sectionType,
				app,
				selectedAlias
			);
		} catch (e) {
			console.error("[agile] appendSnoozeButtonIfEligible failed", {
				error: e,
				taskUid: task._uniqueId,
				sectionType,
				selectedAlias,
			});
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
					} catch (e) {
						console.error("[agile] performUpdate failed", {
							error: e,
							cancel,
							taskUid: task._uniqueId,
						});
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
		} catch (e) {
			console.error(
				"[agile] appendSnoozeButtonIfEligible (rerender) failed",
				{
					error: e,
					taskUid: task._uniqueId,
					sectionType,
					selectedAlias,
				}
			);
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
					} catch (e) {
						console.error(
							"[agile] performUpdate (rerender) failed",
							{
								error: e,
								cancel,
								taskUid: task._uniqueId,
							}
						);
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
	} catch (e) {
		console.error("[agile] rerenderTaskInline failed", {
			error: e,
			taskUid: task._uniqueId,
			newStatus,
			sectionType,
			isRoot,
			depth,
			selectedAlias,
		});
	}
}

export const handleStatusChange = async (
	task: TaskItem,
	liEl: HTMLElement,
	app: App,
	isCancel = false
): Promise<string | null> => {
	try {
		const filePath = task.link?.path;
		if (!filePath) throw new Error("Missing task.link.path");

		const file = app.vault.getAbstractFileByPath(filePath) as TFile;
		if (!file) throw new Error(`File not found: ${filePath}`);

		window.dispatchEvent(
			new CustomEvent("agile:prepare-optimistic-file-change", {
				detail: { filePath },
			})
		);

		const content = await app.vault.read(file);
		const lines = content.split(/\r?\n/);

		let effectiveStatus = (task.status ?? " ").trim() || " ";
		let targetLineIndex = -1;

		const parseStatusFromLine = (line: string): string | null => {
			const m = line.match(/^\s*[-*]\s*\[\s*(.)\s*\]/);
			return m ? m[1] : null;
		};

		const normalize = (s: string) =>
			(s || "")
				.replace(/\s*(✅|❌)\s+\d{4}-\d{2}-\d{2}\b/g, "")
				.replace(/\s+/g, " ")
				.trim();

		const getLineRestNormalized = (line: string): string | null => {
			const m = line.match(/^\s*[-*]\s*\[\s*.\s*\]\s*(.*)$/);
			return m ? normalize(m[1]) : null;
		};

		const targetTextNorm = normalize(
			(task.text || task.visual || "").trim()
		);

		const baseIdx = typeof task.line === "number" ? task.line : -1;
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
				const parsed = parseStatusFromLine(lines[i]);
				if (parsed) effectiveStatus = parsed;
				break;
			}
		}

		if (targetLineIndex === -1 && targetTextNorm) {
			for (let i = 0; i < lines.length; i++) {
				const rest = getLineRestNormalized(lines[i]);
				if (rest && rest === targetTextNorm) {
					targetLineIndex = i;
					const parsed = parseStatusFromLine(lines[i]);
					if (parsed) effectiveStatus = parsed;
					break;
				}
			}
			if (targetLineIndex === -1) {
				for (let i = 0; i < lines.length; i++) {
					const rest = getLineRestNormalized(lines[i]);
					if (rest && rest.startsWith(targetTextNorm)) {
						targetLineIndex = i;
						const parsed = parseStatusFromLine(lines[i]);
						if (parsed) effectiveStatus = parsed;
						break;
					}
				}
			}
		}

		const newStatus = isCancel ? "-" : effectiveStatus === "/" ? "x" : "/";

		const today = new Date();
		const yyyy = String(today.getFullYear());
		const mm = String(today.getMonth() + 1).padStart(2, "0");
		const dd = String(today.getDate()).padStart(2, "0");
		const dateStr = `${yyyy}-${mm}-${dd}`;

		const updateLine = (line: string): string => {
			const m = line.match(/^(\s*[-*]\s*\[\s*)(.)(\s*\]\s*)(.*)$/);
			if (!m) return line;

			const prefix = m[1];
			const bracketSuffix = m[3];
			let rest = m[4] ?? "";

			rest = rest
				.replace(/\s*(✅|❌)\s+\d{4}-\d{2}-\d{2}\b/g, "")
				.trimEnd();

			let updated = `${prefix}${newStatus}${bracketSuffix}${
				rest ? " " + rest : ""
			}`;

			if (newStatus === "x") {
				updated += ` ✅ ${dateStr}`;
			} else if (newStatus === "-") {
				updated += ` ❌ ${dateStr}`;
			}

			return updated;
		};

		let newContent: string | null = null;

		const tryReplaceAtIndex = (idx: number) => {
			if (idx < 0 || idx >= lines.length) return false;
			const originalLine = lines[idx];
			const replaced = updateLine(originalLine);
			if (replaced !== originalLine) {
				lines[idx] = replaced;
				newContent = lines.join("\n");
				return true;
			}
			return false;
		};

		if (targetLineIndex !== -1) {
			tryReplaceAtIndex(targetLineIndex);
		}

		if (newContent == null) {
			const targetText = normalize(
				(task.text || task.visual || "").trim()
			);
			if (targetText) {
				for (let i = 0; i < lines.length; i++) {
					const m = lines[i].match(/^\s*[-*]\s*\[\s*.\s*\]\s*(.*)$/);
					if (!m) continue;
					const rest = normalize(m[1]);
					if (rest === targetText) {
						if (tryReplaceAtIndex(i)) break;
					}
				}
				if (newContent == null) {
					for (let i = 0; i < lines.length; i++) {
						const m = lines[i].match(
							/^\s*[-*]\s*\[\s*.\s*\]\s*(.*)$/
						);
						if (!m) continue;
						const rest = normalize(m[1]);
						if (rest.startsWith(targetText)) {
							if (tryReplaceAtIndex(i)) break;
						}
					}
				}
			}
		}

		if (newContent == null) {
			const escaped = (task.text || "")
				.trim()
				.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			if (escaped) {
				const re = new RegExp(
					`^(\\s*[-*]\\s*\\[\\s*).(\\s*\\]\\s*)${escaped}(.*)$`,
					"m"
				);
				newContent = content.replace(re, (match) => updateLine(match));
				if (newContent === content) {
					newContent = null;
				}
			}
		}

		if (!newContent || newContent === content) {
			throw new Error("Unable to update task line");
		}

		await app.vault.modify(file, newContent);
		(task as any).status = newStatus;

		if (newStatus === "x" || newStatus === "-") {
			try {
				hideTaskAndCollapseAncestors(liEl);
			} catch (e) {
				console.error("[agile] hideTaskAndCollapseAncestors failed", {
					error: e,
					taskUid: task._uniqueId,
				});
			}
		}

		return newStatus;
	} catch (err) {
		console.error("[agile] handleStatusChange failed", {
			error: err,
			taskUid: task?._uniqueId,
			isCancel,
		});
		return null;
	}
};
