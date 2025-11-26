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
	/**
	 * Build the index for all Markdown files and atomically replace the current index
	 * (prevents stale leftovers from previous runs).
	 */
	buildAll(): Promise<void>;

	/** Update (re-parse) a single file after a modification. */
	updateFile(file: TFile): Promise<void>;

	/** Remove a file from the index after deletion. */
	removeFile(path: string): void;

	/** Rename a file within the index; updates IDs and links. */
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

	/**
	 * Resolve a TaskNode by a block reference string in the form "<filePath>#^<blockId>".
	 * If <filePath> is omitted ("#^<blockId>"), implementors MAY scan all files to resolve a unique match.
	 */
	getTaskByBlockRef(blockRef: string): TaskNode | undefined;
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

	const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

	/**
	 * Wait briefly for Obsidian's metadata cache to populate listItems for a modified file.
	 * Helps avoid racing the "modify" event (vault) before the metadata cache is ready.
	 */
	const waitForListItems = async (
		file: TFile,
		maxWaitMs = 600,
		stepMs = 50
	): Promise<CachedMetadata | null> => {
		const end = Date.now() + Math.max(0, maxWaitMs);
		let cache: CachedMetadata | null = app.getFileCache(file);
		if (cache?.listItems?.length) return cache;

		while (Date.now() < end) {
			await delay(stepMs);
			cache = app.getFileCache(file);
			if (cache?.listItems?.length) return cache;
			// Exponential-ish backoff without going wild
			stepMs = Math.min(120, Math.round(stepMs * 1.5));
		}
		return cache ?? null;
	};

	const parseOne = async (file: TFile): Promise<FileTaskSnapshot | null> => {
		// Try to wait for the cache to be ready; reduces wipe-to-empty during rapid edits
		const cache: CachedMetadata | null = await waitForListItems(file);
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
				new CustomEvent<StatusChangedDetail>("agile:task-status-changed", {
					detail,
				})
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

	// Helper: find first node with blockId in a file snap
	const findByBlockIdInFile = (
		fileSnap: FileTaskSnapshot,
		blockId: string
	): TaskNode | undefined => {
		const walk = (nodes: TaskNode[]): TaskNode | undefined => {
			for (const n of nodes) {
				if (n.blockId && n.blockId === blockId) return n;
				if (n.children?.length) {
					const inChild = walk(n.children as TaskNode[]);
					if (inChild) return inChild;
				}
			}
			return undefined;
		};
		return walk(fileSnap.lists);
	};

	// Helper: parse "<path>#^blockId" or "#^blockId"
	const parseBlockRef = (
		ref: string
	): { path?: string; blockId?: string } => {
		const trimmed = (ref ?? "").trim();
		if (!trimmed) return {};
		const hashIdx = trimmed.indexOf("#^");
		if (hashIdx === -1) return {};
		const path = hashIdx > 0 ? trimmed.slice(0, hashIdx) : undefined;
		const blockId = trimmed.slice(hashIdx + 2);
		return { path, blockId: blockId || undefined };
	};

	return {
		/**
		 * Full rebuild that atomically replaces the existing index.
		 * Prevents stale files from lingering if they were removed/renamed outside incremental flow.
		 */
		async buildAll() {
			const files = app.getMarkdownFiles().filter(isMarkdown);
			const snapshotsOrNull = await Promise.all(files.map(parseOne));
			const snapshots = snapshotsOrNull.filter(
				(snap): snap is FileTaskSnapshot => !!snap
			);
			repo.replaceAll(snapshots);
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

		getTaskByBlockRef(blockRef: string) {
			try {
				const { path, blockId } = parseBlockRef(blockRef);
				if (!blockId) return undefined;

				if (path) {
					const snap = repo.getByFile(path);
					if (!snap) return undefined;
					return findByBlockIdInFile(snap, blockId);
				}

				// Fallback: scan all tasks to locate a unique matching blockId
				// (best effort; if multiple, returns first found)
				const all = repo.getAllTasks();
				for (const n of all) {
					if (n.blockId === blockId) return n;
				}
				return undefined;
			} catch {
				return undefined;
			}
		},
	};
}
