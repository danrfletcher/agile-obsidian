import type { CachedMetadata, TFile } from "obsidian";
import type {
	FileTaskSnapshot,
	TaskIndexSnapshot,
	TaskNode,
} from "../domain/task-types";
import type { AppAdapter } from "../../../platform/obsidian/app/app-adapter";
import type { TaskParser } from "../parsing/task-parser";
import { createTaskParser } from "../parsing/task-parser";
import type { TaskIndexRepository } from "../repository/task-index-repository";
import { createInMemoryTaskIndexRepository } from "../repository/task-index-repository";

/**
 * Service that coordinates reading files, parsing items, and storing snapshots in a repository.
 * This is the main entrypoint for programmatic control; orchestration will call into this.
 */
export interface TaskIndexService {
	buildAll(): Promise<void>;
	updateFile(file: TFile): Promise<void>;
	removeFile(path: string): void;
	renameFile(oldPath: string, newPath: string): void;

	// Queries
	getSnapshot(): TaskIndexSnapshot;
	getAllTasks(): TaskNode[];
	getByFile(path: string): FileTaskSnapshot | undefined;
	getById(id: string): TaskNode | undefined;

	/**
	 * Return the task/list item (deepest matching node) covering the cursor's 0-based line number
	 * in the given file. Accepts any object that has at least { filePath, lineNumber }.
	 *
	 * This is intentionally typed structurally to accept your getCursorContext result directly.
	 */
	getItemAtCursor(cursor: {
		filePath: string;
		lineNumber: number;
	}): TaskNode | undefined;
}

export interface TaskIndexServiceDeps {
	/** Abstraction over Obsidian App interactions (vault, cache, read). */
	appAdapter: AppAdapter;
	/** Parser for converting file cache + contents to normalized nodes. */
	parser?: TaskParser;
	/** Repository backend for storing the index in-memory or otherwise. */
	repository?: TaskIndexRepository;
}

/**
 * Factory for TaskIndexService.
 * - Reads markdown files
 * - Parses them into normalized node trees
 * - Stores into repository
 * - Exposes queries
 */
export function createTaskIndexService(
	deps: TaskIndexServiceDeps
): TaskIndexService {
	const parser = deps.parser ?? createTaskParser();
	const repo = deps.repository ?? createInMemoryTaskIndexRepository();
	const app = deps.appAdapter;

	const isMarkdown = (file: TFile) => file.extension === "md";

	const parseOne = async (file: TFile): Promise<FileTaskSnapshot | null> => {
		const cache: CachedMetadata | null = app.getFileCache(file);
		if (!cache || !cache.listItems) {
			// Store an empty snapshot to represent the file without lists
			return { filePath: file.path, lists: [] };
		}
		let contents: string;
		try {
			contents = await app.readFile(file);
		} catch {
			// Read errors are treated as transient; caller will not update repo
			return null;
		}
		return parser.parseFile({ file, contents, cache });
	};

	type Status = string | undefined | null;
	type StatusChangedDetail = {
		filePath: string;
		id: string;
		line0: number;
		fromStatus: Status;
		toStatus: Status;
	};

	const dispatchStatusChanged = (detail: StatusChangedDetail) => {
		try {
			document.dispatchEvent(
				new CustomEvent<StatusChangedDetail>(
					"agile:task-status-changed" as any,
					{ detail }
				)
			);
		} catch (e) {
			// Non-fatal
			console.warn(
				"[task-index] dispatch agile:task-status-changed failed",
				e
			);
		}
	};

	const flatten = (nodes: TaskNode[]): TaskNode[] => {
		const out: TaskNode[] = [];
		const walk = (n: TaskNode) => {
			out.push(n);
			for (const c of (n.children as TaskNode[]) ?? []) walk(c);
		};
		for (const n of nodes) walk(n);
		return out;
	};

	const mapById = (nodes: TaskNode[]): Map<string, TaskNode> => {
		const m = new Map<string, TaskNode>();
		for (const n of flatten(nodes)) {
			if (n._uniqueId) m.set(n._uniqueId, n);
		}
		return m;
	};

	const norm = (s: Status): string => {
		const v = (s ?? "").toString();
		return v.length ? v.toLowerCase() : "";
	};

	return {
		async buildAll() {
			const files = app.getMarkdownFiles();
			const snapshots = await Promise.all(
				files.filter(isMarkdown).map(parseOne)
			);
			snapshots.forEach((snap) => {
				if (!snap) return;
				repo.upsertFileSnapshot(snap);
			});
		},

		async updateFile(file) {
			if (!isMarkdown(file)) return;

			// Capture previous snapshot before re-parse
			const prevSnap = repo.getByFile(file.path);

			const snapshot = await parseOne(file);
			if (!snapshot) return;

			// Emit status-change events before updating repo
			if (prevSnap?.lists?.length) {
				try {
					const prevMap = mapById(prevSnap.lists);
					const nextFlat = flatten(snapshot.lists);
					for (const next of nextFlat) {
						// We only care about checkbox lines
						if (!next.status) continue;
						const prev = next._uniqueId
							? prevMap.get(next._uniqueId)
							: undefined;
						const prevStatus = prev?.status ?? "";
						const nextStatus = next.status ?? "";
						if (norm(prevStatus) !== norm(nextStatus)) {
							dispatchStatusChanged({
								filePath: snapshot.filePath,
								id: next._uniqueId!,
								line0: next.position.start.line,
								fromStatus: prevStatus,
								toStatus: nextStatus,
							});
						}
					}
				} catch (e) {
					console.warn(
						"[task-index] failed to diff for status changes",
						e
					);
				}
			}

			// Update repository after events
			repo.upsertFileSnapshot(snapshot);
		},

		removeFile(path) {
			repo.removeFile(path);
		},

		renameFile(oldPath, newPath) {
			repo.renameFile(oldPath, newPath);
		},

		// Queries
		getSnapshot() {
			return repo.getSnapshot();
		},
		getAllTasks() {
			return repo.getAllTasks();
		},
		getByFile(path) {
			return repo.getByFile(path);
		},
		getById(id) {
			return repo.getById(id);
		},

		getItemAtCursor(cursor) {
			const { filePath, lineNumber } = cursor;
			if (!filePath || typeof lineNumber !== "number") return undefined;
			return repo.getNodeAtLine(filePath, lineNumber);
		},
	};
}
