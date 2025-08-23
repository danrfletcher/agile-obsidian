/**
 * Assignment cascade logic: maintain consistency between implicit (inherited) and explicit assignments.
 *
 * In-app context:
 * - A task without an explicit assignee inherits from the nearest ancestor that has one.
 * - When a parent changes, descendants may need explicit marks added/removed to preserve intent.
 *
 * Plugin value:
 * - Ensures users' effective assignments remain stable and redundant marks are cleaned up automatically.
 */

import type { App, Editor, TFile } from "obsidian";
import type { TaskIndex } from "../index/TaskIndex";

export type CascadeDeps = {
	app: App;
	taskIndex: TaskIndex;
	normalizeTaskLine: (line: string, opts?: any) => string;
	isUncheckedTaskLine: (line: string) => boolean; // retained for backward compat; not used in cascade anymore
	getExplicitAssigneeAliasFromText: (line: string) => string | null;
	buildAssigneeMarkForAlias: (
		alias: string,
		variant: "active" | "inactive",
		team: any
	) => string;
};

/**
 * Apply an assignee change on a specific line, then cascade across descendants.
 *
 * In-app use:
 * - Invoked by Assign commands and the mark context menu.
 *
 * Plugin value:
 * - Wraps update + dedupe + cascade in one operation to keep task trees coherent.
 */
export async function applyAssigneeChangeWithCascade(
	filePath: string,
	editor: Editor,
	lineNo: number,
	oldAlias: string | null,
	newAlias: string | null,
	variant: "active" | "inactive",
	team: any,
	deps: CascadeDeps
): Promise<void> {
	// Local, status-agnostic task detector: allow any status except x and -
	const isReassignableTaskLine = (line: string): boolean => {
		const m = /^\s*[-*]\s*\[\s*([^\]]?)\s*\]/i.exec(line);
		if (!m) return false;
		const status = (m[1] ?? "").trim().toLowerCase();
		return status !== "x" && status !== "-";
	};

	// Snapshot before edits for cascade
	const beforeLines = editor.getValue().split("\n");

	// Update the target line first
	const originalLine = editor.getLine(lineNo);
	const newMark = newAlias
		? deps.buildAssigneeMarkForAlias(newAlias, variant, team)
		: null;
	let updated = deps.normalizeTaskLine(originalLine, {
		newAssigneeMark: newMark,
	});
	if (/<\/mark>\s*$/.test(updated)) updated = updated.replace(/\s*$/, " ");
	editor.replaceRange(
		updated,
		{ line: lineNo, ch: 0 },
		{ line: lineNo, ch: originalLine.length }
	);

	// Update TaskIndex to current file before cascade/redundancy checks
	try {
		const af = deps.app.vault.getAbstractFileByPath(filePath);
		if (af && (af as any).extension === "md") {
			await deps.taskIndex.updateFile(af as unknown as TFile);
		}
	} catch {
		/* no-op */
	}

	// Redundancy cleanup (explicit equals inherited)
	try {
		const fileEntry = (deps.taskIndex.getIndex() as any)?.[filePath];
		if (fileEntry) {
			const linesNow = editor.getValue().split("\n");

			// Build line->item and id->item maps from index
			const byLine = new Map<number, any>();
			const byId = new Map<string, any>();
			const collect = (items: any[]) => {
				for (const it of items) {
					const l0 = (it.line ?? 1) - 1;
					byLine.set(l0, it);
					if (it._uniqueId) byId.set(it._uniqueId, it);
					if (Array.isArray(it.children)) collect(it.children);
				}
			};
			collect(fileEntry.lists || []);

			// Status-agnostic alias capture: consider all reassignable lines
			const aliasNow: (string | null)[] = linesNow.map((ln) =>
				isReassignableTaskLine(ln)
					? deps.getExplicitAssigneeAliasFromText(ln)
					: null
			);

			const nearestUp = (
				l0: number,
				aliasMap: (string | null)[]
			): string | null => {
				let cur = byLine.get(l0);
				while (cur) {
					const parentId = cur._parentId;
					if (!parentId) return null;
					const parent = byId.get(parentId);
					if (!parent) return null;
					const pLine0 = (parent.line ?? 1) - 1;
					const v = aliasMap[pLine0];
					if (v) return v;
					cur = parent;
				}
				return null;
			};

			const explicitOnLine = aliasNow[lineNo];
			if (explicitOnLine) {
				// Compute inherited ignoring self
				const saved = aliasNow[lineNo];
				aliasNow[lineNo] = null;
				const inherited = nearestUp(lineNo, aliasNow);
				aliasNow[lineNo] = saved;

				if (
					inherited &&
					inherited.toLowerCase() === explicitOnLine.toLowerCase()
				) {
					const after = editor.getLine(lineNo);
					let cleaned = deps.normalizeTaskLine(after, {
						newAssigneeMark: null,
					});
					if (/<\/mark>\s*$/.test(cleaned))
						cleaned = cleaned.replace(/\s*$/, " ");
					editor.replaceRange(
						cleaned,
						{ line: lineNo, ch: 0 },
						{ line: lineNo, ch: after.length }
					);
				}
			}
		}
	} catch {
		/* no-op */
	}

	// Then cascade adjustments (computed against pre-edit snapshot)
	await applyAssigneeCascade(
		filePath,
		editor,
		lineNo,
		oldAlias,
		newAlias,
		team,
		deps,
		beforeLines
	);
}

/**
 * Ensure effective assignments remain constant across descendants after a parent assignment change.
 *
 * In-app use:
 * - Called internally by applyAssigneeChangeWithCascade, and by external triggers to re-stabilize trees.
 *
 * Plugin value:
 * - Maintains the implicit assignment invariant by adding/removing explicit marks as needed.
 */
export async function applyAssigneeCascade(
	filePath: string,
	editor: Editor,
	parentLineNo: number,
	oldAlias: string | null,
	newAlias: string | null,
	team: any,
	deps: CascadeDeps,
	beforeLines?: string[]
): Promise<void> {
	try {
		if (oldAlias === newAlias) return;

		// Local, status-agnostic task detector: allow any status except x and -
		const isReassignableTaskLine = (line: string): boolean => {
			const m = /^\s*[-*]\s*\[\s*([^\]]?)\s*\]/i.exec(line);
			if (!m) return false;
			const status = (m[1] ?? "").trim().toLowerCase();
			return status !== "x" && status !== "-";
		};

		// Build alias maps before and after parent change (use pre-edit snapshot if provided)
		const lines = beforeLines ?? editor.getValue().split("\n");

		// Ensure we have an index entry for this file before proceeding
		try {
			const af = deps.app.vault.getAbstractFileByPath(filePath);
			if (
				af instanceof (deps.app.vault.constructor as any).TFile ||
				(af as any)?.extension === "md"
			) {
				if ((af as any).extension === "md") {
					await deps.taskIndex.updateFile(af as unknown as TFile);
				}
			}
		} catch (err) {
			void err;
		}

		// Acquire the indexed tree for this file
		const fileEntry = (deps.taskIndex.getIndex() as any)?.[filePath];
		if (!fileEntry) return;

		// Map line(0-based) -> TaskItem, and id -> TaskItem
		const byLine = new Map<number, any>();
		const byId = new Map<string, any>();
		const collect = (items: any[]) => {
			for (const it of items) {
				const l0 = (it.line ?? 1) - 1;
				byLine.set(l0, it);
				if (it._uniqueId) byId.set(it._uniqueId, it);
				if (Array.isArray(it.children)) collect(it.children);
			}
		};
		collect(fileEntry.lists || []);

		const parentItem = byLine.get(parentLineNo);
		if (!parentItem) return;

		// Collect descendant line numbers (0-based) under the parent
		const descendants: number[] = [];
		const dfs = (it: any) => {
			for (const ch of it.children || []) {
				const l0 = (ch.line ?? 1) - 1;
				descendants.push(l0);
				dfs(ch);
			}
		};
		dfs(parentItem);

		// Helper: explicit alias on a line (status-agnostic)
		const explicitAliasOn = (l0: number) =>
			isReassignableTaskLine(lines[l0] || "")
				? deps.getExplicitAssigneeAliasFromText(lines[l0] || "")
				: null;

		const aliasBefore: (string | null)[] = lines.map((_, i) =>
			explicitAliasOn(i)
		);
		const aliasAfter: (string | null)[] = aliasBefore.slice();
		aliasAfter[parentLineNo] = newAlias; // parent updated

		// Resolve nearest ancestor explicit alias for a given line, using a given alias map
		const nearestUp = (
			l0: number,
			aliasMap: (string | null)[]
		): string | null => {
			let cur = byLine.get(l0);
			while (cur) {
				const line0 = (cur.line ?? 1) - 1;
				const v = aliasMap[line0];
				if (v) return v;
				const pid = cur._parentId;
				cur = pid ? byId.get(pid) : null;
			}
			return null;
		};
		// Variant that also returns the source ancestor line that provided the alias
		const nearestUpWithSource = (
			l0: number,
			aliasMap: (string | null)[]
		): { alias: string | null; source: number | null } => {
			let cur = byLine.get(l0);
			while (cur) {
				const line0 = (cur.line ?? 1) - 1;
				const v = aliasMap[line0];
				if (v) return { alias: v, source: line0 };
				const pid = cur._parentId;
				cur = pid ? byId.get(pid) : null;
			}
			return { alias: null, source: null };
		};

		// Pass 1: preserve previous effective assignment for each descendant
		const toSetExplicit = new Map<number, string>(); // line -> alias to set
		for (const d of descendants) {
			if (!isReassignableTaskLine(lines[d] || "")) continue;

			const explicitD = aliasBefore[d];
			const prevEff = explicitD ?? nearestUp(d, aliasBefore);
			const newEffCandidate =
				(explicitD ?? nearestUp(d, aliasAfter)) || null;

			if (prevEff !== newEffCandidate) {
				if (prevEff) {
					toSetExplicit.set(d, prevEff);
					aliasAfter[d] = prevEff; // reflect the planned explicit addition
				}
			} else {
				// If effective assignment stayed the same, but it was previously INFERRED
				// from the changed ancestor (parentLineNo), make it explicit to preserve intent.
				if (!explicitD && prevEff) {
					const beforeSrc = nearestUpWithSource(
						d,
						aliasBefore
					).source;
					if (beforeSrc === parentLineNo) {
						toSetExplicit.set(d, prevEff);
						aliasAfter[d] = prevEff;
					}
				}
			}
		}

		// Pass 2: remove redundant explicits that now match inherited value
		const toRemoveExplicit = new Set<number>();
		for (const d of descendants) {
			if (!isReassignableTaskLine(lines[d] || "")) continue;

			const explicitD = aliasAfter[d];
			if (!explicitD) continue;

			// Compute inherited alias if this line had no explicit (exclude self)
			const saved = aliasAfter[d];
			aliasAfter[d] = null;
			const inherited = nearestUp(d, aliasAfter);
			aliasAfter[d] = saved;

			if (inherited && inherited === explicitD) {
				// If we just added this explicit in pass 1 to preserve a different assignment, skip removal
				const wasAdded = toSetExplicit.has(d);
				if (!wasAdded) toRemoveExplicit.add(d);
			}
		}

		// Apply changes to editor
		for (const [lineNo, alias] of toSetExplicit.entries()) {
			const orig = editor.getLine(lineNo);
			const mark = deps.buildAssigneeMarkForAlias(alias, "active", team);
			let upd = deps.normalizeTaskLine(orig, { newAssigneeMark: mark });
			if (/<\/mark>\s*$/.test(upd)) upd = upd.replace(/\s*$/, " ");
			editor.replaceRange(
				upd,
				{ line: lineNo, ch: 0 },
				{ line: lineNo, ch: orig.length }
			);
		}

		for (const lineNo of toRemoveExplicit) {
			const orig = editor.getLine(lineNo);
			let upd = deps.normalizeTaskLine(orig, { newAssigneeMark: null });
			if (/<\/mark>\s*$/.test(upd)) upd = upd.replace(/\s*$/, " ");
			editor.replaceRange(
				upd,
				{ line: lineNo, ch: 0 },
				{ line: lineNo, ch: orig.length }
			);
		}
	} catch (err) {
		void err;
	}
}

/**
 * Cascade after an external (non-editor) assignment change, using a pre-change snapshot when available.
 *
 * In-app use:
 * - Triggered by events fired from other surfaces (e.g., dashboard) to keep file content consistent.
 *
 * Plugin value:
 * - Preserves user intent and keeps redundant marks minimal even for "optimistic" edits outside the editor.
 */
export async function applyCascadeAfterExternalChange(
	filePath: string,
	parentLine0: number,
	beforeLines: string[] | null,
	newAlias: string | null,
	team: any,
	deps: CascadeDeps
): Promise<void> {
	try {
		const af = deps.app.vault.getAbstractFileByPath(filePath);
		if (!(af as any) || (af as any).extension !== "md") return;

		// Ensure we have a current index for structure (parents/children)
		let fileEntry = (deps.taskIndex.getIndex() as any)?.[filePath];
		if (!fileEntry) {
			await deps.taskIndex.updateFile(af as unknown as TFile);
			fileEntry = (deps.taskIndex.getIndex() as any)?.[filePath];
			if (!fileEntry) return;
		}

		// Build maps of line -> item and id -> item
		const byLine = new Map<number, any>();
		const byId = new Map<string, any>();
		const collect = (items: any[]) => {
			for (const it of items) {
				const l0 = (it.line ?? 1) - 1;
				byLine.set(l0, it);
				if (it._uniqueId) byId.set(it._uniqueId, it);
				if (Array.isArray(it.children)) collect(it.children);
			}
		};
		collect(fileEntry.lists || []);

		const parentItem = byLine.get(parentLine0);
		if (!parentItem) return;

		// Collect descendant line numbers (0-based) under the parent
		const descendants: number[] = [];
		const dfs = (it: any) => {
			for (const ch of it.children || []) {
				const l0 = (ch.line ?? 1) - 1;
				descendants.push(l0);
				dfs(ch);
			}
		};
		dfs(parentItem);

		// Local, status-agnostic task detector: allow any status except x and -
		const isReassignableTaskLine = (line: string): boolean => {
			const m = /^\s*[-*]\s*\[\s*([^\]]?)\s*\]/i.exec(line);
			if (!m) return false;
			const status = (m[1] ?? "").trim().toLowerCase();
			return status !== "x" && status !== "-";
		};

		// Before snapshot (for computing previous effective assignments)
		const before =
			beforeLines ??
			(await (deps.app.vault as any).cachedRead(af)).split("\n");
		// After content (we'll apply our cascade edits on top of this)
		const afterContent = await (deps.app.vault as any).cachedRead(af);
		const lines = afterContent.split("\n");

		const explicitOn = (ln: string): string | null =>
			isReassignableTaskLine(ln)
				? deps.getExplicitAssigneeAliasFromText(ln)
				: null;

		const aliasBefore: (string | null)[] = before.map((ln: string) =>
			explicitOn(ln)
		);
		const aliasAfter: (string | null)[] = lines.map((ln: string) =>
			explicitOn(ln)
		);

		// Reflect the changed parent explicit alias in aliasAfter for accurate inheritance
		aliasAfter[parentLine0] = newAlias;

		// Resolve nearest ancestor explicit alias for a given line, using a given alias map
		const nearestUp = (
			l0: number,
			aliasMap: (string | null)[]
		): string | null => {
			let cur = byLine.get(l0);
			while (cur) {
				const line0 = (cur.line ?? 1) - 1;
				const v = aliasMap[line0];
				if (v) return v;
				const pid = cur._parentId;
				cur = pid ? byId.get(pid) : null;
			}
			return null;
		};
		// Variant that also returns the source ancestor line that provided the alias
		const nearestUpWithSource = (
			l0: number,
			aliasMap: (string | null)[]
		): { alias: string | null; source: number | null } => {
			let cur = byLine.get(l0);
			while (cur) {
				const line0 = (cur.line ?? 1) - 1;
				const v = aliasMap[line0];
				if (v) return { alias: v, source: line0 };
				const pid = cur._parentId;
				cur = pid ? byId.get(pid) : null;
			}
			return { alias: null, source: null };
		};

		const toSetExplicit = new Map<number, string>(); // line -> alias to set explicitly
		for (const d of descendants) {
			if (!isReassignableTaskLine(lines[d] || "")) continue;

			// Previous effective assignment (explicit or inherited)
			const explicitD = aliasBefore[d];
			const prevEff = explicitD ?? nearestUp(d, aliasBefore);
			// New effective assignment after the change (using updated aliasAfter parent)
			const newEff = aliasAfter[d] ?? nearestUp(d, aliasAfter);

			if (prevEff !== newEff) {
				if (prevEff) {
					toSetExplicit.set(d, prevEff);
					aliasAfter[d] = prevEff; // Reflect planned explicit addition for downstream inheritance
				}
			} else {
				// If effective assignment stayed same but was previously inferred from the changed ancestor,
				// convert it to an explicit assignment to preserve intent.
				if (!explicitD && prevEff) {
					const beforeSrc = nearestUpWithSource(
						d,
						aliasBefore
					).source;
					if (beforeSrc === parentLine0) {
						toSetExplicit.set(d, prevEff);
						aliasAfter[d] = prevEff;
					}
				}
			}
		}

		// Pass 2: remove redundant explicits that now match inherited value
		const toRemoveExplicit = new Set<number>();
		for (const d of descendants) {
			if (!isReassignableTaskLine(lines[d] || "")) continue;

			const explicitD = aliasAfter[d];
			if (!explicitD) continue;

			// Exclude self to compute inherited value
			const saved = aliasAfter[d];
			aliasAfter[d] = null;
			const inherited = nearestUp(d, aliasAfter);
			aliasAfter[d] = saved;

			// If an explicit equals inherited and wasn't just added to preserve a change, remove it
			if (inherited && inherited === explicitD && !toSetExplicit.has(d)) {
				toRemoveExplicit.add(d);
			}
		}

		let changed = false;

		for (const [lineNo, alias] of toSetExplicit.entries()) {
			const orig = lines[lineNo] ?? "";
			const mark = deps.buildAssigneeMarkForAlias(alias, "active", team);
			let upd = deps.normalizeTaskLine(orig, { newAssigneeMark: mark });
			if (/<\/mark>\s*$/.test(upd)) upd = upd.replace(/\s*$/, " ");
			if (upd !== orig) {
				lines[lineNo] = upd;
				changed = true;
			}
		}

		for (const lineNo of toRemoveExplicit) {
			const orig = lines[lineNo] ?? "";
			let upd = deps.normalizeTaskLine(orig, { newAssigneeMark: null });
			if (/<\/mark>\s*$/.test(upd)) upd = upd.replace(/\s*$/, " ");
			if (upd !== orig) {
				lines[lineNo] = upd;
				changed = true;
			}
		}

		if (changed) {
			await (deps.app.vault as any).modify(af, lines.join("\n"));
			// Keep TaskIndex fresh after cascading edits
			await deps.taskIndex.updateFile(af as unknown as TFile);
		}
	} catch (err) {
		void err;
	}
}
