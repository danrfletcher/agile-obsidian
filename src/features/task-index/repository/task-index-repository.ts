import type {
	FileTaskSnapshot,
	TaskIndexSnapshot,
	TaskNode,
} from "../domain/task-types";

/**
 * Repository responsible for storing and querying the task index in memory.
 */
export interface TaskIndexRepository {
	/** Insert or replace a single file snapshot. */
	upsertFileSnapshot(snapshot: FileTaskSnapshot): void;

	/** Remove a file entirely from the index. */
	removeFile(path: string): void;

	/** Rename a file key and update node paths/IDs immutably. */
	renameFile(oldPath: string, newPath: string): void;

	/** Atomically replace the entire index with the provided snapshots. */
	replaceAll(snapshots: FileTaskSnapshot[]): void;

	/** Getters */
	getSnapshot(): TaskIndexSnapshot;
	getByFile(path: string): FileTaskSnapshot | undefined;
	getAllTasks(): TaskNode[];
	getById(id: string): TaskNode | undefined;
	getNodeAtLine(path: string, line0: number): TaskNode | undefined;
}

/**
 * In-memory repository. Produces new objects on rename/replace to avoid aliasing issues.
 */
export function createInMemoryTaskIndexRepository(): TaskIndexRepository {
	let index: TaskIndexSnapshot = {};

	return {
		upsertFileSnapshot(snapshot) {
			// Store a shallow copy to discourage external mutation
			index[snapshot.filePath] = {
				filePath: snapshot.filePath,
				lists: snapshot.lists,
			};
		},

		removeFile(path) {
			delete index[path];
		},

		renameFile(oldPath, newPath) {
			const snap = index[oldPath];
			if (!snap) return;
			const updated = reassignPathsImmutable(snap, newPath);
			delete index[oldPath];
			index[newPath] = updated;
		},

		replaceAll(snapshots) {
			const next: TaskIndexSnapshot = {};
			for (const snap of snapshots) {
				if (!snap) continue;
				next[snap.filePath] = {
					filePath: snap.filePath,
					lists: snap.lists,
				};
			}
			index = next;
		},

		getSnapshot() {
			return index;
		},

		getByFile(path) {
			return index[path];
		},

		getAllTasks() {
			const result: TaskNode[] = [];
			Object.values(index).forEach((fileSnap) => {
				const collect = (nodes: TaskNode[]) => {
					nodes.forEach((n) => {
						result.push(n);
						if (n.children?.length)
							collect(n.children as TaskNode[]);
					});
				};
				collect(fileSnap.lists);
			});
			return result;
		},

		getById(id) {
			for (const fileSnap of Object.values(index)) {
				const found = findById(fileSnap.lists, id);
				if (found) return found;
			}
			return undefined;
		},

		getNodeAtLine(path, line0) {
			const fileSnap = index[path];
			if (!fileSnap) return undefined;
			return findDeepestCoveringLine(fileSnap.lists, line0);
		},
	};
}

function findById(nodes: TaskNode[], id: string): TaskNode | undefined {
	for (const n of nodes) {
		if (n._uniqueId === id) return n;
		if (n.children?.length) {
			const child = findById(n.children as TaskNode[], id);
			if (child) return child;
		}
	}
	return undefined;
}

/**
 * Return true if a node's position span covers the 0-based line number.
 */
function coversLine(node: TaskNode, line0: number): boolean {
	const start = node.position.start.line;
	const end = node.position.end?.line ?? start;
	return line0 >= start && line0 <= end;
}

/**
 * Find the deepest node in the subtree that covers the given line.
 * Depth-first: prefer a matching child over its parent.
 */
function findDeepestCoveringLine(
	nodes: TaskNode[],
	line0: number
): TaskNode | undefined {
	for (const node of nodes) {
		if (!coversLine(node, line0)) continue;
		if (node.children?.length) {
			const inChild = findDeepestCoveringLine(
				node.children as TaskNode[],
				line0
			);
			if (inChild) return inChild;
		}
		return node;
	}
	return undefined;
}

/**
 * Reassign file path (and derived IDs/links) immutably.
 */
function reassignPathsImmutable(
	snapshot: FileTaskSnapshot,
	newPath: string
): FileTaskSnapshot {
	const renameNode = (node: TaskNode, oldPath: string): TaskNode => {
		const newId = node.blockId
			? `${newPath}:^${node.blockId}:${node.line}`
			: `${newPath}:${node.line}`;
		const newParentId =
			node._parentId && node._parentId.startsWith(oldPath + ":")
				? node._parentId.replace(oldPath + ":", newPath + ":")
				: node._parentId;

		return {
			...node,
			_uniqueId: newId,
			_parentId: newParentId,
			link: {
				...node.link,
				path: newPath,
				subpath: node.blockId ? `#^${node.blockId}` : "",
			},
			header: {
				...node.header,
				link: { ...node.header.link, path: newPath },
			},
			children: (node.children as TaskNode[]).map((c) =>
				renameNode(c, oldPath)
			),
		};
	};

	const oldPath = snapshot.filePath;
	return {
		filePath: newPath,
		lists: snapshot.lists.map((n) => renameNode(n, oldPath)),
	};
}
