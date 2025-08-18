import { App, CachedMetadata, ListItemCache, TFile } from "obsidian";
import { TaskItem } from "src/types/TaskItem";

// Singleton class for TaskIndex
export class TaskIndex {
	private static instance: TaskIndex | null = null;
	private app: App;
	private index: { [filePath: string]: { lists: TaskItem[] } } = {};

	// Private constructor to enforce singleton
	private constructor(app: App) {
		this.app = app;
	}

	// Singleton getter
	public static getInstance(app: App): TaskIndex {
		if (!TaskIndex.instance) {
			TaskIndex.instance = new TaskIndex(app);
		}
		return TaskIndex.instance;
	}

	// Build the index by scanning all Markdown files (async)
	public async buildIndex() {
		this.index = {};
		const files = this.app.vault.getMarkdownFiles();
		await Promise.all(files.map((file) => this.indexFile(file)));
	}

	// Targeted update for a single file (e.g., on modify or create)
	public async updateFile(file: TFile) {
		if (file.extension !== "md") return; // Only handle Markdown
		await this.indexFile(file);
	}

	// Remove a file from the index (e.g., on delete or rename)
	public removeFile(path: string) {
		delete this.index[path];
	}

	// Index tasks and lists for a single file (async for file reading)
	private async indexFile(file: TFile) {
		const cache: CachedMetadata | null =
			this.app.metadataCache.getFileCache(file);
		if (!cache || !cache.listItems) {
			// If no lists, remove from index if it exists
			this.removeFile(file.path);
			return;
		}

		// Read file contents
		let contents: string;
		try {
			contents = await this.app.vault.cachedRead(file);
		} catch (error) {
			console.error(`Error reading file ${file.path}:`, error);
			return;
		}
		const lines = contents.split(/\r?\n/);

		// Map cache items to TaskItem, extracting from lines
		const taskItemsMap: { [line: number]: TaskItem } = {};
		cache.listItems.forEach((item: ListItemCache) => {
			const lineNum = item.position.start.line;
			const lineText = lines[lineNum] || "";

			// Parse text: remove leading -/*/[ ] and trim
			const textMatch = lineText.match(
				/^[ \t]*(?:[-*+]|\d+[.)])\s*(?:\[(.)?\]\s*)?(.*)/
			);
			const rawText = textMatch ? textMatch[2].trim() : lineText.trim();

			// Parse blockId: check for ^ at end
			const blockIdMatch = rawText.match(/\s*\^\w+$/);
			const text = blockIdMatch
				? rawText.slice(0, blockIdMatch.index).trim()
				: rawText;
			const blockId = blockIdMatch
				? blockIdMatch[0].trim().slice(1)
				: undefined;

			// Determine if it's a task or plain list item
			const isTask = item.task !== undefined;
			const status = isTask ? item.task : undefined;
			const checked = isTask ? status === "x" || status === "X" : false; // Only for tasks

			const taskItem: TaskItem = {
				checked,
				completed: checked,
				fullyCompleted: checked, // Will update later based on children (only for tasks)
				text,
				visual: lineText.trim(), // Full line for visual
				line: lineNum + 1,
				lineCount:
					item.position.end.line - item.position.start.line + 1,
				position: item.position,
				children: [],
				task: isTask ? true : undefined,
				listItem: !isTask ? true : undefined,
				annotated: false, // TODO: Detect tags/dates in text if needed
				parent: item.parent ?? -1,
				blockId,
				header: {
					link: {
						path: file.path,
						display: "", // TODO: Fetch from sections if needed
						embed: false,
						subpath: "",
					},
					level: 0,
				},
				status,
				link: {
					path: file.path,
					display: file.basename,
					embed: false,
					subpath: blockId ? `#^${blockId}` : "",
				},
			};

			taskItemsMap[lineNum] = taskItem;
		});

		// Build hierarchy: assign children based on parent
		const rootItems: TaskItem[] = [];
		Object.values(taskItemsMap).forEach((item) => {
			if (item.parent >= 0 && taskItemsMap[item.parent]) {
				const parentItem = taskItemsMap[item.parent];
				parentItem.children.push(item);
				// Update fullyCompleted only if parent is a task
				if (parentItem.task) {
					parentItem.fullyCompleted =
						parentItem.checked &&
						parentItem.children.every(
							(c) => !c.task || c.fullyCompleted
						);
				}
			} else {
				rootItems.push(item);
			}
		});

		// Assign unique IDs *after* hierarchy is built
		this.assignUniqueIds(rootItems, file.path);

		// Store in index (only root lists/tasks)
		this.index[file.path] = { lists: rootItems };
	}

	// Public method to get the full index
	public getIndex() {
		return this.index;
	}

	// Method to refresh the entire index (fallback)
	public async refresh() {
		await this.buildIndex();
	}

	public getAllTasks(): TaskItem[] {
		const allTasks: TaskItem[] = [];
		Object.values(this.index).forEach(({ lists }) => {
			// Flatten children recursively (includes roots)
			const flattenChildren = (items: TaskItem[]) => {
				items.forEach((item) => {
					allTasks.push(item);
					if (item.children) flattenChildren(item.children);
				});
			};
			flattenChildren(lists);
		});
		return allTasks;
	}

	// Add unique IDs if not present (call in buildIndex or updateFile)
	private assignUniqueIds(items: TaskItem[], filePath: string) {
		const assign = (
			item: TaskItem,
			parentId: string | null | undefined
		) => {
			item._uniqueId = `${filePath}:${item.line}`;
			item._parentId = parentId ?? null; // Use nullish coalescing for safety (defaults to null if undefined)
			item.children.forEach((child) =>
				assign(child, item._uniqueId ?? null)
			); // Safe recursion
		};
		items.forEach((item) => assign(item, null));
	}
}
