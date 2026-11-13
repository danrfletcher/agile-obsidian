/**
 * Vault-wide "Run canonical formatter": dry-run to count the notes that would change,
 * ask for confirmation, then rewrite only those notes.
 *
 * Reads files only when a run is started (never at startup). The host (Obsidian) is
 * reached through the small `VaultReorderHost` interface so the flow can be tested with
 * an in-memory vault.
 */

import { reorderNoteContent } from "../domain/canonical-note";

export type VaultFileContent = { path: string; content: string };

export type PlannedReorder = {
	path: string;
	/** Text the plan was computed from. */
	before: string;
	/** Text after reordering. Always different from `before`. */
	after: string;
	changedLines: number;
};

/** Pure dry run: the notes whose text would change, in input order. */
export function planVaultReorder(
	files: readonly VaultFileContent[]
): PlannedReorder[] {
	const changed: PlannedReorder[] = [];
	for (const f of files) {
		const r = reorderNoteContent(f.content);
		if (r.changedLines > 0 && r.content !== f.content) {
			changed.push({
				path: f.path,
				before: f.content,
				after: r.content,
				changedLines: r.changedLines,
			});
		}
	}
	return changed;
}

export type VaultReorderHost<F> = {
	/** All markdown files in the vault (no content read yet). */
	listFiles(): F[];
	pathOf(file: F): string;
	read(file: F): Promise<string>;
	/**
	 * Atomically rewrite a file from its current text. Must hand the callback the text
	 * as it is now, so an edit made after the dry run is never overwritten with stale text.
	 */
	process(file: F, fn: (current: string) => string): Promise<void>;
	/** Show the "Reorder chips in N notes?" dialog; false on cancel, Esc or close. */
	confirm(noteCount: number): Promise<boolean>;
	notify(message: string): void;
	/** Optional: give the UI a turn between batches of files. */
	yieldToUi?(): Promise<void>;
};

export type VaultReorderResult =
	| { status: "busy" }
	| { status: "none"; scanned: number }
	| { status: "cancelled"; scanned: number; changed: number }
	| {
			status: "done";
			scanned: number;
			changed: number;
			written: number;
			failed: number;
			lines: number;
	  };

const YIELD_EVERY_N_FILES = 50;

/**
 * Builds the vault-wide runner. Only one run (dry run, dialog or write) is active at a
 * time: a second call while one is in flight returns `{ status: "busy" }` and does nothing.
 */
export function createVaultReorderRunner<F>(host: VaultReorderHost<F>) {
	let busy = false;

	return async function run(): Promise<VaultReorderResult> {
		if (busy) return { status: "busy" };
		busy = true;
		try {
			// 1) Dry run: read every note, keep only the ones that would change.
			const files = host.listFiles();
			const changed: Array<{ file: F; path: string }> = [];
			for (let i = 0; i < files.length; i++) {
				const file = files[i];
				const path = host.pathOf(file);
				const content = await host.read(file);
				if (planVaultReorder([{ path, content }]).length > 0) {
					changed.push({ file, path });
				}
				if (host.yieldToUi && i % YIELD_EVERY_N_FILES === 0 && i > 0) {
					await host.yieldToUi();
				}
			}

			if (changed.length === 0) {
				host.notify("Nothing to reorder: no notes need their chips reordered.");
				return { status: "none", scanned: files.length };
			}

			// 2) Confirm. Nothing is written unless this resolves true.
			const ok = await host.confirm(changed.length);
			if (!ok) {
				return {
					status: "cancelled",
					scanned: files.length,
					changed: changed.length,
				};
			}

			host.notify("Started formatting all files…");

			// 3) Write only the planned notes, each recomputed from its current text.
			let written = 0;
			let failed = 0;
			let lines = 0;
			for (let i = 0; i < changed.length; i++) {
				try {
					let fileLines = 0;
					await host.process(changed[i].file, (current) => {
						const r = reorderNoteContent(current);
						fileLines = r.changedLines;
						return r.content;
					});
					if (fileLines > 0) {
						written++;
						lines += fileLines;
					}
				} catch {
					failed++;
				}
				if (host.yieldToUi && i % YIELD_EVERY_N_FILES === 0 && i > 0) {
					await host.yieldToUi();
				}
			}

			host.notify(
				`Canonical formatting complete: ${written} file(s), ${lines} line(s) updated.` +
					(failed ? ` ${failed} file(s) could not be written.` : "")
			);
			return {
				status: "done",
				scanned: files.length,
				changed: changed.length,
				written,
				failed,
				lines,
			};
		} finally {
			busy = false;
		}
	};
}
