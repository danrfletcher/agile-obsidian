/**
 * Utilities for resolving, updating, and propagating task assignee marks within a Markdown file.
 *
 * This module centralizes logic around:
 * - Parsing explicit assignee marks (👋) embedded in task lines.
 * - Resolving the effective assignee of a task by walking up its ancestor chain.
 * - Applying an assignment change to a target task and preserving descendant assignments by
 *   explicitly adding/removing marks as needed.
 *
 * How it fits into the plugin:
 * - Relies on TaskIndex (src/index/TaskIndex.ts) to provide a tree of TaskItem nodes and stable IDs.
 *   The index also ensures each TaskItem has a unique `_uniqueId` and `_parentId`, which are used here.
 * - Uses normalizeTaskLine (src/utils/format/taskFormatter.ts) to insert or remove assignee marks
 *   in a consistent way that coexists with other inline tokens (dates, delegates, etc.).
 * - Interacts with the vault via Obsidian's App API to read/modify file contents when updating assignments.
 * - Is typically called by command handlers that change assignment for the active task/selection.
 *
 */
import { App, TFile } from "obsidian";
import { TaskIndex } from "../../index/TaskIndex";
import { TaskItem } from "../../types/TaskItem";
import { normalizeTaskLine } from "../format/taskFormatter";
import { aliasToName } from "../commands/commandUtils";

/**
 * Builds the inline HTML <mark> element used to represent an explicit assignee on a task line.
 * - The mark takes the form: <mark class="active-${alias}"><strong>👋 Display</strong></mark>
 * - For the special "team" alias, the display text is "Everyone".
 *
 * Used by:
 * - updateAssigneeAndPropagate when applying a new assignment or when explicitly preserving a descendant's previous assignee.
 *
 * @param {string} alias - The normalized assignee alias (e.g., "john-doe-1a2b3c", "team").
 * @returns {string} The HTML string to embed in the task line.
 */
function buildAssigneeMark(alias: string): string {
	const display =
		(alias || "").toLowerCase() === "team" ? "Everyone" : aliasToName(alias);
	return `<mark class="active-${alias}" style="background: #BBFABBA6;"><strong>👋 ${display}</strong></mark>`;
}

/**
 * Extracts an explicit assignee alias from a task line, if present.
 * - Detects both team/everyone marks and member marks.
 * - Returns "team" for a team mark, or the lowercase member alias for a member mark.
 * - Returns null if no explicit assignee is found or if parsing fails.
 *
 * Used by:
 * - resolveAssigneeForNode to determine a task's own explicit assignee.
 * - computeNewInheritedAfterChange when evaluating inheritance from ancestors.
 * - updateAssigneeAndPropagate when snapshotting descendant assignments before a change.
 *
 * @param {string} line - The raw Markdown line of the task.
 * @returns {string | null} The explicit assignee alias or null if none.
 */
function getExplicitAssigneeAliasFromLine(line: string): string | null {
	try {
		if (!line) return null;
		// Everyone mark (team)
		const everyone = /<mark\s+class="(?:active|inactive)-team"[^>]*>\s*<strong>[\s\S]*?<\/strong>\s*<\/mark>/i.exec(
			line
		);
		if (everyone) return "team";

		// Member assignee mark (👋 ...)
		const m =
			/<mark\s+class="(?:active|inactive)-([a-z0-9-]+)"[^>]*>\s*<strong>👋[\s\S]*?<\/strong>\s*<\/mark>/i.exec(
				line
			);
		return m ? m[1].toLowerCase() : null;
	} catch {
		return null;
	}
}

/**
 * Flattens a tree of TaskItem nodes into a single array (preorder).
 *
 * Used by:
 * - updateAssigneeAndPropagate to quickly look up a TaskItem by line or id and to iterate descendants.
 *
 * @param {TaskItem[]} items - Root TaskItem nodes (often from TaskIndex for a file).
 * @param {TaskItem[]} [acc=[]] - Accumulator for recursion (do not pass in normal use).
 * @returns {TaskItem[]} A flattened list of all nodes (roots included).
 */
function flatten(items: TaskItem[], acc: TaskItem[] = []): TaskItem[] {
	for (const it of items) {
		acc.push(it);
		if (it.children && it.children.length) flatten(it.children, acc);
	}
	return acc;
}

/**
 * Builds helper maps for quick ID-based lookups.
 * - byId: TaskItem by its `_uniqueId` (as assigned by TaskIndex).
 * - parentId: Maps a `_uniqueId` to its `_parentId` (or null for roots).
 *
 * Used by:
 * - resolveAssigneeForNode and computeNewInheritedAfterChange to walk ancestor chains.
 * - updateAssigneeAndPropagate for locating the target node and related ancestors/descendants.
 *
 * @param {TaskItem[]} items - Flattened TaskItems from a file.
 * @returns {{ byId: Map<string, TaskItem>, parentId: Map<string, string | null> }} Helper maps.
 */
function buildIdMaps(items: TaskItem[]) {
	const byId = new Map<string, TaskItem>();
	const parentId = new Map<string, string | null>();
	for (const it of items) {
		if (it._uniqueId) {
			byId.set(it._uniqueId, it);
			parentId.set(it._uniqueId, (it as any)._parentId ?? null);
		}
	}
	return { byId, parentId };
}

/**
 * Produces the ancestor chain (IDs) for a given TaskItem ID, ordered from parent upward.
 * The target itself is not included; the first element is the immediate parent (if present).
 *
 * Used by:
 * - resolveAssigneeForNode to look for explicit assignees up the hierarchy.
 *
 * @param {string} targetId - The `_uniqueId` for the target TaskItem.
 * @param {Map<string, string | null>} parentId - Map from `_uniqueId` to `_parentId`.
 * @returns {string[]} An array of ancestor IDs, closest first.
 */
function getAncestorsChain(
	targetId: string,
	parentId: Map<string, string | null>
): string[] {
	const chain: string[] = [];
	let cur: string | null = targetId;
	while (cur) {
		const p: string | null = parentId.get(cur) ?? null;
		if (p) chain.push(p);
		cur = p;
	}
	return chain;
}

/**
 * Determines the effective assignee for a TaskItem by:
 * 1) Checking for an explicit assignee on the node's own line.
 * 2) If none, searching ancestors (closest first) for the first explicit assignee.
 * 3) Returning null if no explicit assignee is found in the chain (i.e., unassigned).
 *
 * Used by:
 * - updateAssigneeAndPropagate to snapshot descendants' resolved assignees before a change.
 *
 * @param {TaskItem} item - The node to resolve.
 * @param {string[]} lines - File content split into lines (index 0-based).
 * @param {Map<string, TaskItem>} byId - Map of `_uniqueId` to TaskItem.
 * @param {Map<string, string | null>} parentId - Map of `_uniqueId` to `_parentId`.
 * @returns {string | null} The resolved alias (e.g., "team" or member alias) or null if unassigned.
 */
function resolveAssigneeForNode(
	item: TaskItem,
	lines: string[],
	byId: Map<string, TaskItem>,
	parentId: Map<string, string | null>
): string | null {
	// Prefer explicit on the node itself
	const myLineIdx = (item.line ?? 1) - 1;
	if (myLineIdx >= 0 && myLineIdx < lines.length) {
		const own = getExplicitAssigneeAliasFromLine(lines[myLineIdx]);
		if (own) return own;
	}

	// Else first explicit up the chain
	const id = item._uniqueId || "";
	const chain = getAncestorsChain(id, parentId);
	for (const aid of chain) {
		const a = byId.get(aid);
		if (!a) continue;
		const lidx = (a.line ?? 1) - 1;
		if (lidx >= 0 && lidx < lines.length) {
			const al = getExplicitAssigneeAliasFromLine(lines[lidx]);
			if (al) return al;
		}
	}
	return null;
}

/**
 * Computes what a descendant's inherited assignee would become after a change is applied to a target node.
 * - Walks up the chain from the descendant; if the chain crosses the changed target, inheritance becomes `newAlias`.
 * - Otherwise, it returns the first explicit assignee found on an ancestor (pre-change), if any.
 * - Returns null if no explicit assignment is found in the walk.
 *
 * Used by:
 * - updateAssigneeAndPropagate to decide whether a descendant's explicit mark can be removed as redundant,
 *   or whether an explicit mark needs to be added to preserve the prior resolved assignee.
 *
 * @param {TaskItem} item - The descendant node being evaluated.
 * @param {string} changedId - The `_uniqueId` of the node that is being explicitly changed.
 * @param {string} newAlias - The new alias being set on the changed node.
 * @param {string[]} linesBefore - File lines before applying descendant changes (target already normalized).
 * @param {Map<string, TaskItem>} byId - Map of `_uniqueId` to TaskItem.
 * @param {Map<string, string | null>} parentId - Map of `_uniqueId` to `_parentId`.
 * @returns {string | null} The inherited alias after the change (ignoring the descendant's explicit), or null.
 */
function computeNewInheritedAfterChange(
	item: TaskItem,
	changedId: string,
	newAlias: string,
	linesBefore: string[],
	byId: Map<string, TaskItem>,
	parentId: Map<string, string | null>
): string | null {
	// Walk up; if/when we hit the changed node, inheritance becomes newAlias; else use explicit on ancestor if present.
	let curId = item._uniqueId || "";
	while (curId) {
		if (curId === changedId) {
			return newAlias;
		}
		const p = parentId.get(curId) ?? null;
		if (!p) break;
		const parent = byId.get(p);
		if (parent) {
			const lidx = (parent.line ?? 1) - 1;
			if (lidx >= 0 && lidx < linesBefore.length) {
				const exp = getExplicitAssigneeAliasFromLine(
					linesBefore[lidx]
				);
				if (exp) return exp;
			}
		}
		curId = p;
	}
	return null;
}

/**
 * Applies a new assignee to a target task and updates descendants so that their previously resolved
 * assignees remain unchanged unless explicitly overridden.
 *
 * Process:
 * 1) Identify the target TaskItem by uid (filePath:line) or by id from the TaskIndex.
 * 2) Snapshot each descendant's resolved assignee BEFORE the change (walking ancestors as needed).
 * 3) Modify the target line to include the new explicit assignee mark.
 * 4) For each descendant, compare the previously resolved assignee to what it would inherit now:
 *    - If unchanged and the descendant had a redundant explicit mark equal to the new inheritance, remove it.
 *    - If it would change, add an explicit mark to preserve the original resolved assignee.
 * 5) Persist file changes via the Obsidian vault.
 *
 * Used by:
 * - Command handlers that assign tasks to a member or to the team (e.g., dynamic commands built in main.ts),
 *   ensuring consistent and predictable propagation of assignments in nested task structures.
 *
 * @param {App} app - Obsidian app instance.
 * @param {string} uid - Unique identifier in the form "filePath:lineNumber" for the target node.
 * @param {string} newAlias - The alias to assign (e.g., "team" or a member alias).
 * @returns {Promise<void>} Resolves when file content has been updated or if no change was needed.
 */
export async function updateAssigneeAndPropagate(
	app: App,
	uid: string,
	newAlias: string
): Promise<void> {
	try {
		if (!uid || !newAlias) return;
		const parts = uid.split(":");
		const filePath = parts[0] || "";
		const lineNo = Number(parts[1] || "0");
		if (!filePath || !lineNo || isNaN(lineNo)) return;

		const file = app.vault.getAbstractFileByPath(filePath) as TFile;
		if (!file) return;

		const index = TaskIndex.getInstance(app);
		await index.updateFile(file);

		const idxData = index.getIndex()[filePath];
		if (!idxData) return;

		const items = flatten(idxData.lists);
		const { byId, parentId } = buildIdMaps(items);

		// Find target by line or uid
		const target =
			items.find((it) => (it.line ?? -1) === lineNo) ||
			(byId.get(uid) as TaskItem | undefined);
		if (!target) return;

		// Load content (before-change)
		const content = await app.vault.read(file);
		const lines = content.split(/\r?\n/);

		// Snapshot resolved assignment for all descendants BEFORE the change
		const collectDescendants = (root: TaskItem): TaskItem[] => {
			const acc: TaskItem[] = [];
			const walk = (it: TaskItem) => {
				if (!it.children) return;
				for (const c of it.children) {
					acc.push(c);
					walk(c);
				}
			};
			walk(root);
			return acc;
		};
		const descendants = collectDescendants(target);

		const oldResolved = new Map<string, string | null>();
		for (const d of descendants) {
			oldResolved.set(
				d._uniqueId || `${filePath}:${d.line}`,
				resolveAssigneeForNode(d, lines, byId, parentId)
			);
		}

		// 1) Update the changed line to the new assignee
		const targetIdx = lineNo - 1;
		if (targetIdx < 0 || targetIdx >= lines.length) return;

		const newMark = buildAssigneeMark(newAlias);
		lines[targetIdx] = normalizeTaskLine(lines[targetIdx], {
			newAssigneeMark: newMark,
		});

		// 2) For each descendant, ensure its resolved assignee remains what it was BEFORE the change
		for (const d of descendants) {
			const id = d._uniqueId || `${filePath}:${d.line}`;
			const desired = oldResolved.get(id) ?? null;

			const dLineIdx = (d.line ?? 1) - 1;
			if (dLineIdx < 0 || dLineIdx >= lines.length) continue;
			const explicitBefore = getExplicitAssigneeAliasFromLine(
				lines[dLineIdx]
			);

			// New inherited after the change (ignoring the child's explicit)
			const newInherited = computeNewInheritedAfterChange(
				d,
				target._uniqueId || `${filePath}:${lineNo}`,
				newAlias,
				lines,
				byId,
				parentId
			);

			// If no change to resolved assignee is needed, optionally simplify redundant explicit assignment
			if (desired === (explicitBefore || newInherited)) {
				if (explicitBefore && desired === newInherited) {
					// Redundant explicit equal to new inheritance: remove it
					lines[dLineIdx] = normalizeTaskLine(lines[dLineIdx], {
						newAssigneeMark: null,
					});
				}
				continue;
			}

			// Resolved assignee would change; preserve the original by making it explicit
			if (!explicitBefore && desired) {
				lines[dLineIdx] = normalizeTaskLine(lines[dLineIdx], {
					newAssigneeMark: buildAssigneeMark(desired),
				});
			}
		}

		const newContent = lines.join("\n");
		if (newContent !== content) {
			await app.vault.modify(file, newContent);
		}
	} catch {
		// no-op
	}
}
