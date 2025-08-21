import { App, TFile } from "obsidian";
import { isUncheckedTaskLine } from "../utils/commands/commandUtils";
import { TaskItem } from "../types/TaskItem";

/**
 * Read a file and return unchecked tasks lines with positions.
 * Guards for undefined cache and missing files to avoid TS2532.
 */
export async function getUncheckedTasksFromFile(
	app: App,
	file: TFile
): Promise<TaskItem[]> {
	const metadata = app.metadataCache.getFileCache(file);
	if (!metadata || !metadata.listItems || metadata.listItems.length === 0)
		return [];

	const content = await app.vault.read(file);
	const lines = content.split(/\r?\n/);

	const tasks: TaskItem[] = [];
	for (const li of metadata.listItems) {
		const line = lines[li.position.start.line] ?? "";
		if (isUncheckedTaskLine(line)) {
			const blockIdMatch = line.match(/\s*\^\w+$/);
			const blockId = blockIdMatch ? blockIdMatch[0].trim().slice(1) : undefined;

			tasks.push({
				checked: false,
				completed: false,
				fullyCompleted: false,
				text: line,
				visual: line,
				line: li.position.start.line + 1,
				lineCount: li.position.end.line - li.position.start.line + 1,
				position: li.position,
				children: [],
				task: true,
				listItem: undefined,
				annotated: false,
				parent: li.parent ?? -1,
				blockId,
				header: {
					link: {
						path: file.path,
						display: "",
						embed: false,
						subpath: "",
					},
					level: 0,
				},
				status: " ",
				link: {
					path: file.path,
					display: file.basename,
					embed: false,
					subpath: blockId ? `#^${blockId}` : "",
				},
			} as TaskItem);
		}
	}
	return tasks;
}

/**
 * Toggle a task checkbox at a given file and line.
 */
export async function toggleTaskAtLine(
	app: App,
	file: TFile,
	lineIdx: number
): Promise<void> {
	const content = await app.vault.read(file);
	const lines = content.split(/\r?\n/);
	const line = lines[lineIdx];
	if (line === undefined) return;

	const toggled = line
		.replace(/^(\s*)- \[ \]/, "$1- [x]")
		.replace(/^(\s*)- \[x\]/i, "$1- [ ]");
	if (toggled !== line) {
		lines[lineIdx] = toggled;
		await app.vault.modify(file, lines.join("\n"));
	}
}
