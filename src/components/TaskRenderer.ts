import { App, Component, MarkdownRenderer, TFile } from "obsidian";
import { TaskItem } from "../types/TaskItem";

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
			const header = document.createElement("h4");
			header.textContent = task.link.display;
			header.className = "task-file-header";
			container.appendChild(header);
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
	const ul = document.createElement("ul");
	ul.style.listStyleType = "none";
	ul.style.paddingLeft = `${level * 40}px`;
	ul.style.margin = "0";
	ul.style.lineHeight = "1.2";
	ul.className = "dataview dataview-ul dataview-result-list-ul";

	tasks.forEach((task) => {
		const isRealTask = task.task !== false;

		const forcedChecked =
			task.status === "x" || task.checked || task.completed;

		const li = document.createElement("li");
		li.className =
			"dataview task-list-item" + (forcedChecked ? " is-checked" : "");
		li.dataset.task = task.status || " ";
		li.style.display = "flex";
		li.style.alignItems = "center";
		li.style.marginBottom = "4px";
		li.style.padding = "2px 0";

		if (isRealTask) {
			const currentStatus = task.status || " ";
			const isEligible =
				[" ", "/", "d"].includes(currentStatus) &&
				sectionType !== "objectives" &&
				(sectionType !== "responsibilities" || currentStatus === "d");

			const checkbox = document.createElement("input");
			checkbox.className = "dataview task-list-item-checkbox";
			checkbox.type = "checkbox";
			checkbox.style.marginRight = "8px";
			checkbox.title = isEligible
				? "Tap/Click to advance status; Long-press or Ctrl/Cmd+Click to cancel"
				: "";
			if (forcedChecked) checkbox.checked = true;
			if (!isEligible) checkbox.disabled = true;

			if (isEligible) {
				checkbox.addEventListener("click", (event) =>
					handleStatusChange(
						task,
						app,
						event.ctrlKey || event.metaKey
					)
				);
				// Add long-press logic if needed (e.g., using setTimeout for detection)
			}

			li.appendChild(checkbox);
		} else {
			const spacer = document.createElement("span");
			spacer.style.width = "24px";
			spacer.style.display = "inline-block";
			li.appendChild(spacer);
		}

		const textContainer = document.createElement("span");
		textContainer.className = "dataview-result-list-li-span";
		textContainer.style.cursor = "pointer";

		const renderedText = document.createElement("span");
		MarkdownRenderer.render(
			app,
			task.text,
			renderedText,
			task.link.path,
			new Component()
		); // Fixed: Pass new Component() instead of null
		textContainer.appendChild(renderedText);

		textContainer.onclick = () => {
			// Open file at task position (using Obsidian APIs)
			const file = app.vault.getAbstractFileByPath(
				task.link.path
			) as TFile;
			if (file) {
				app.workspace.openLinkText("", task.link.path, false, {
					active: true,
				});
				// Optionally, scroll to line: use editor API after opening
			}
		};

		li.appendChild(textContainer);

		// Example: Add snooze button
		const snoozeButton = document.createElement("button");
		snoozeButton.textContent = "💤";
		snoozeButton.onclick = () => handleSnooze(task, app);
		li.appendChild(snoozeButton);

		ul.appendChild(li);
	});

	container.appendChild(ul);
};

export const handleStatusChange = async (
	task: TaskItem,
	app: App,
	isCancel = false
): Promise<void> => {
	const file = app.vault.getAbstractFileByPath(task.link.path) as TFile;
	if (!file) return;

	let content = await app.vault.read(file);
	const lines = content.split("\n");
	const lineIndex = task.line - 1; // 0-based

	if (lineIndex < 0 || lineIndex >= lines.length) return;

	let line = lines[lineIndex];
	const newStatus = isCancel ? "-" : task.status === " " ? "/" : "x"; // Example logic; adapt from original

	// Replace status (assuming Markdown task format like - [ ] Task)
	line = line.replace(/\[.\]/, `[${newStatus}]`);

	lines[lineIndex] = line;
	content = lines.join("\n");
	await app.vault.modify(file, content);

	// Optionally, refresh index: TaskIndex.getInstance(app).buildIndex();
};

export const handleSnooze = async (
	task: TaskItem,
	app: App,
	snoozeDate?: string
): Promise<void> => {
	const file = app.vault.getAbstractFileByPath(task.link.path) as TFile;
	if (!file) return;

	let content = await app.vault.read(file);
	const lines = content.split("\n");
	const lineIndex = task.line - 1;

	if (lineIndex < 0 || lineIndex >= lines.length) return;

	let line = lines[lineIndex];
	const snoozeText = snoozeDate ? `💤 ${snoozeDate}` : "💤"; // Example

	line += ` ${snoozeText}`; // Append to task text

	lines[lineIndex] = line;
	content = lines.join("\n");
	await app.vault.modify(file, content);

	// Refresh index if needed
};
