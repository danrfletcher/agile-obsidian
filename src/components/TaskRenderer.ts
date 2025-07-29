import {
	App,
	Component,
	MarkdownRenderer,
	TFile,
	MarkdownView,
} from "obsidian";
import { TaskItem } from "../types/TaskItem";
import { teamMemberName, isDirectlyAssigned } from "../utils/taskFilters";
import { getTaskType, isRecurringResponsibility } from "../utils/taskTypes";

export const renderTaskTree = (
	tasks: TaskItem[],
	container: HTMLElement,
	app: App,
	level = 0,
	groupByFile = false,
	sectionType = ""
): void => {
	tasks.forEach((task) => {
		if (groupByFile && level === 0 && task.link.path) {
			container.createEl("h4", {
				text: task.link.display,
				cls: "task-file-header",
			});
		}

		renderTaskList([task], container, app, level, sectionType);

		if (task.children && task.children.length > 0) {
			renderTaskTree(
				task.children,
				container,
				app,
				level + 1,
				false,
				sectionType
			);
		}
	});
};

export const renderTaskList = (
	tasks: TaskItem[],
	container: HTMLElement,
	app: App,
	level = 0,
	sectionType = ""
): void => {
	const ul = container.createEl("ul", {
		attr: {
			style: `list-style-type: none; padding-left: ${
				level * 40
			}px; margin: 0; line-height: 1.2;`,
		},
		cls: "dataview dataview-ul dataview-result-list-ul",
	});

	tasks.forEach((task) => {
		const isRealTask = task.task !== false;

		const forcedChecked =
			task.status === "x" || task.checked || task.completed;

		const li = ul.createEl("li", {
			cls:
				"dataview task-list-item" +
				(forcedChecked ? " is-checked" : ""),
			attr: {
				"data-task": task.status || " ",
				style: "display: flex; align-items: center; margin-bottom: 4px; padding: 2px 0;",
			},
		});

		if (isRealTask) {
			const currentStatus = task.status || " ";
			const isEligible =
				[" ", "/", "d"].includes(currentStatus) &&
				sectionType !== "objectives" &&
				(sectionType !== "responsibilities" || currentStatus === "d");

			const checkbox = li.createEl("input", {
				cls: "dataview task-list-item-checkbox",
				type: "checkbox",
				attr: {
					"data-task": currentStatus,
					style: "margin-right: 8px;",
					title: isEligible
						? "Tap/Click to advance status; Long-press or Ctrl/Cmd+Click to cancel"
						: "",
				},
			});
			if (forcedChecked) checkbox.checked = true;
			if (!isEligible) checkbox.disabled = true;

			if (isEligible) {
				let longPressTimer: NodeJS.Timeout | null = null;
				const longPressDuration = 500;

				const startLongPress = (event: MouseEvent | TouchEvent) => {
					event.stopPropagation();
					longPressTimer = setTimeout(() => {
						handleStatusChange(task, app, true); // Cancel
					}, longPressDuration);
				};

				const cancelLongPress = () => {
					if (longPressTimer) clearTimeout(longPressTimer);
				};

				const handleClick = (event: MouseEvent) => {
					event.stopPropagation();
					if (event.ctrlKey || event.metaKey) {
						handleStatusChange(task, app, true); // Cancel with modifier
					} else {
						handleStatusChange(task, app, false); // Cycle
					}
				};

				checkbox.addEventListener("click", handleClick);
				checkbox.addEventListener("mousedown", startLongPress);
				checkbox.addEventListener("mouseup", cancelLongPress);
				checkbox.addEventListener("mouseleave", cancelLongPress);
				checkbox.addEventListener("touchstart", startLongPress);
				checkbox.addEventListener("touchend", cancelLongPress);
			}
		} else {
			li.createEl("span", {
				attr: { style: "width: 24px; display: inline-block;" },
			});
		}

		const textContainer = li.createEl("span", {
			cls: "dataview-result-list-li-span",
			attr: { style: "cursor: pointer;" },
		});
		const renderedText = textContainer.createEl("span");
		MarkdownRenderer.render(
			app,
			task.text,
			renderedText,
			task.link.path,
			new Component()
		);

		textContainer.onclick = (event) => {
			const target = event.target;
			if (
				target instanceof HTMLElement &&
				(target.tagName === "A" || target.closest("a"))
			) {
				return;
			}
			app.workspace.openLinkText(task.link.path, task.link.path, false, {
				active: true,
			});
			setTimeout(() => {
				const activeView =
					app.workspace.getActiveViewOfType(MarkdownView);
				if (activeView) {
					const editor = activeView.editor;
					editor.setCursor({ line: task.line - 1, ch: 0 });
					editor.scrollIntoView(
						{
							from: { line: task.line - 1, ch: 0 },
							to: { line: task.line - 1, ch: 0 },
						},
						true
					);
				}
			}, 100);
		};

		if (sectionType === "objectives" || sectionType === "priorities")
			return;

		// Snooze logic (adapted from original)
		const shouldAddSnoozeButton = (t: TaskItem) => {
			if (sectionType === "responsibilities")
				return isRecurringResponsibility(t);
			if (
				(!t.children || t.children.length === 0) &&
				isDirectlyAssigned(t)
			)
				return true;
			const parent = t.parent >= 0 ? /* fetch parent */ null : null; // Placeholder - use taskMap if needed
			if (
				getTaskType(t) === "epic" &&
				parent &&
				getTaskType(parent) === "initiative"
			)
				return true;
			if (getTaskType(t) === "initiative") return true;
			return false;
		};

		const countEligibleSubtasks = (t: TaskItem) =>
			t.children ? t.children.filter(shouldAddSnoozeButton).length : 0;

		const shouldAddButton = shouldAddSnoozeButton(task);
		let shouldAddSnoozeAll = false;
		if (
			task.children &&
			task.children.length > 0 &&
			sectionType !== "responsibilities"
		) {
			const eligibleCount = countEligibleSubtasks(task);
			if (eligibleCount > 1) shouldAddSnoozeAll = true;
		}

		if (shouldAddButton || shouldAddSnoozeAll) {
			let isProcessing = false;
			const debounce = <Args extends unknown[]>(
				func: (...args: Args) => void | Promise<void>,
				delay: number
			) => {
				let timeout: NodeJS.Timeout | null = null;
				return (...args: Args) => {
					if (timeout) clearTimeout(timeout);
					timeout = setTimeout(() => func(...args), delay);
				};
			};
			const handleSnoozeFn = debounce(
				async (
					targetTask: TaskItem,
					snoozeDateStr: string | null,
					isSubtaskSnooze = false,
					buttonElement: HTMLButtonElement
				) => {
					if (isProcessing) return;
					isProcessing = true;

					try {
						const today = new Date();
						const targetDate =
							snoozeDateStr ||
							new Date(today.setDate(today.getDate() + 1))
								.toISOString()
								.split("T")[0];

						const snoozeIcon = isSubtaskSnooze ? "💤⬇️" : "💤";
						const userSnooze = `${snoozeIcon}<span style="display: none">${teamMemberName}</span> ${targetDate}`;

						const file = app.vault.getAbstractFileByPath(
							targetTask.link.path
						) as TFile;
						if (!file)
							throw new Error(
								`File not found: ${targetTask.link.path}`
							);

						let content = await app.vault.read(file);

						content = content.replace(
							targetTask.text,
							(matchedText) => {
								let updatedText = matchedText;

								const globalSnoozeRegex =
									/💤\s*(\d{4}-\d{2}-\d{2})(?!\s*<span)/g;
								updatedText = updatedText.replace(
									globalSnoozeRegex,
									(match, date) => {
										const snoozeDate = new Date(date);
										snoozeDate.setHours(0, 0, 0, 0);
										if (snoozeDate <= today)
											return userSnooze;
										return match;
									}
								);

								const userSnoozeRegex = new RegExp(
									`💤\\s*<span[^>]*>${teamMemberName}</span>\\s*(\\d{4}-\\d{2}-\\d{2})?`,
									"g"
								);
								updatedText = updatedText.replace(
									userSnoozeRegex,
									""
								);

								if (!/\s$/.test(updatedText))
									updatedText += " ";
								updatedText += userSnooze;

								return updatedText;
							}
						);

						await app.vault.modify(file, content);
						buttonElement.innerText = "⏳"; // Visual feedback
					} catch (error) {
						console.error("Error during snooze:", error);
					} finally {
						isProcessing = false;
					}
				},
				300
			);

			if (shouldAddButton) {
				const snoozeBtn = li.createEl("button", {
					text: "💤",
					cls: "snooze-btn",
					attr: {
						style: "margin-left: 8px; cursor: pointer; background: none; border: none; font-size: 1em;",
					},
				});
				snoozeBtn.addEventListener("click", (event) => {
					event.stopPropagation();
					snoozeBtn.innerText = "⏳";
					handleSnoozeFn(task, null, false, snoozeBtn);
				});

				const customDateBtn = li.createEl("button", {
					text: "▶️",
					cls: "custom-snooze-btn",
					attr: {
						style: "margin-left: 4px; cursor: pointer; background: none; border: none; font-size: 1em;",
					},
				});
				customDateBtn.addEventListener("click", (event) => {
					event.stopPropagation();
					const input = li.createEl("input", {
						attr: {
							type: "text",
							placeholder: "YYYY-MM-DD",
							style: "width: 100px; margin-left: 4px;",
						},
					});
					customDateBtn.replaceWith(input);
					input.focus();

					const submitCustomDate = () => {
						const dateStr = input.value.trim();
						if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
							snoozeBtn.innerText = "⏳";
							handleSnoozeFn(task, dateStr, false, snoozeBtn);
						} else {
							console.error("Invalid date format");
						}
						input.remove();
					};
					input.addEventListener("keydown", (e) => {
						if (e.key === "Enter") submitCustomDate();
					});
					input.addEventListener("blur", submitCustomDate);
				});
			}

			if (shouldAddSnoozeAll) {
				const snoozeAllBtn = li.createEl("button", {
					text: "💤⬇️",
					cls: "snooze-all-btn",
					attr: {
						style: "margin-left: 8px; cursor: pointer; background: none; border: none; font-size: 1em;",
					},
				});
				snoozeAllBtn.addEventListener("click", (event) => {
					event.stopPropagation();
					snoozeAllBtn.innerText = "⏳";
					handleSnoozeFn(task, null, true, snoozeAllBtn);
				});
			}
		}
	});
};

export const handleStatusChange = async (
	task: TaskItem,
	app: App,
	isCancel = false
): Promise<void> => {
	try {
		const currentStatus = task.status || " ";
		let newStatus = currentStatus;

		if (isCancel) {
			newStatus = "-";
		} else {
			if (currentStatus === " ") newStatus = "/";
			else if (currentStatus === "/" || currentStatus === "d")
				newStatus = "x";
			else return;
		}

		const file = app.vault.getAbstractFileByPath(task.link.path) as TFile;
		if (!file) throw new Error(`File not found: ${task.link.path}`);

		const content = await app.vault.read(file);
		const escapedTaskText = task.text.replace(
			/[.*+?^${}()|[\]\\]/g,
			"\\$&"
		);

		const taskLineRegex = new RegExp(
			`^(\\s*[-*]\\s*)\\[\\s*${currentStatus}\\s*\\]\\s*(${escapedTaskText})\\s*$`,
			"gm"
		);

		const newContent = content.replace(
			taskLineRegex,
			(match, prefix, textPart) => {
				let updatedLine = `${prefix}[${newStatus}] ${textPart}`;
				if (newStatus === "x" && !isCancel) {
					const today = new Date().toISOString().split("T")[0];
					const completionMarker = ` ✅ ${today}`;
					if (!/\s$/.test(updatedLine)) updatedLine += " ";
					updatedLine += completionMarker;
				}
				return updatedLine;
			}
		);

		if (newContent === content)
			throw new Error("No matching task line found");

		await app.vault.modify(file, newContent);
	} catch (error) {
		console.error("Error updating task status:", error);
	}
};
