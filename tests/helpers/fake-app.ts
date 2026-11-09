import type {
	LinkArtifactApp,
	LinkTarget,
} from "@features/templating-engine/domain/link-artifact-resolver";

export type FakeAppOptions = {
	/** path -> markdown (or any) file content */
	files: Record<string, string>;
	/** folder paths that exist */
	folders?: string[];
	/** paths whose read rejects */
	failRead?: string[];
};

export type FakeApp = LinkArtifactApp & {
	/** every path passed to cachedRead, in order */
	reads: string[];
	/** every (linkpath, sourcePath) passed to getFirstLinkpathDest */
	linkLookups: Array<[string, string]>;
	/** the unwrapped read (use it from a replaced vault.cachedRead) */
	readNow(file: LinkTarget): Promise<string>;
	/** delete a file after creation (simulates a delete between two lookups) */
	remove(path: string): void;
};

const extOf = (path: string): string => {
	const base = path.split("/").pop() ?? path;
	const i = base.lastIndexOf(".");
	return i === -1 ? "" : base.slice(i + 1);
};

/**
 * In-memory stand-in for the parts of Obsidian's App that the link-artifact lookup uses.
 * getFirstLinkpathDest mimics wiki-link resolution: "Note" or "Dir/Note" matches the
 * first markdown file whose path is, or ends with "/", that link path plus ".md".
 */
export function makeFakeApp(opts: FakeAppOptions): FakeApp {
	const files = { ...opts.files };
	const folders = new Set(opts.folders ?? []);
	const failRead = new Set(opts.failRead ?? []);
	const reads: string[] = [];
	const linkLookups: Array<[string, string]> = [];

	const entry = (path: string): LinkTarget => ({
		path,
		extension: extOf(path),
	});

	const readNow = (file: LinkTarget): Promise<string> => {
		reads.push(file.path);
		if (failRead.has(file.path)) {
			return Promise.reject(new Error("read failed"));
		}
		const content = files[file.path];
		return content === undefined
			? Promise.reject(new Error("ENOENT"))
			: Promise.resolve(content);
	};

	return {
		reads,
		linkLookups,
		readNow,
		remove: (path: string) => {
			delete files[path];
		},
		vault: {
			getAbstractFileByPath: (path: string) => {
				if (Object.keys(files).includes(path)) {
					return entry(path);
				}
				if (folders.has(path)) return { path };
				return null;
			},
			cachedRead: readNow,
		},
		metadataCache: {
			getFirstLinkpathDest: (linkpath: string, sourcePath: string) => {
				linkLookups.push([linkpath, sourcePath]);
				const want = `${linkpath}.md`;
				const hit = Object.keys(files).find(
					(p) => p === want || p.endsWith(`/${want}`)
				);
				return hit ? entry(hit) : null;
			},
		},
	};
}
