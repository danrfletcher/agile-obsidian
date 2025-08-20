import { App, TFile } from "obsidian";
import { TaskIndex } from "../../index/TaskIndex";
import { TaskItem } from "../../types/TaskItem";
import { normalizeTaskLine } from "../format/taskFormatter";
import { aliasToName } from "../commands/commandUtils";

function buildAssigneeMark(alias: string): string {
	const display =
		(alias || "").toLowerCase() === "team" ? "Everyone" : aliasToName(alias);
	return `<mark class="active-${alias}" style="background: #BBFABBA6;"><strong>👋 ${display}</strong></mark>`;
}

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

function flatten(items: TaskItem[], acc: TaskItem[] = []): TaskItem[] {
	for (const it of items) {
		acc.push(it);
		if (it.children && it.children.length) flatten(it.children, acc);
	}
	return acc;
}

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
