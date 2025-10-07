import type { App, Plugin } from "obsidian";
import { MarkdownView, Notice, TFile } from "obsidian";
import type { TaskIndexService } from "@features/task-index";
import { renderTemplateOnly } from "@features/templating-engine";
import { removeWrappersOfTypeOnLine } from "@features/task-assignment";
import { getDisplayNameFromAlias } from "@shared/identity";
import {
	indentWidth,
	isListLine,
	isTaskLine, // NEW: import to match tasks with any status
} from "@platform/obsidian";

// ---------- helpers ----------
function getExplicitAssigneeSlugFromText(line: string): string | null {
	if (!line || typeof line !== "string") return null;
	const wrapperRe =
		/<span\b[^>]*\bdata-template-key\s*=\s*"members\.assignee"[^>]*>/gi;
	let m: RegExpExecArray | null;
	while ((m = wrapperRe.exec(line)) !== null) {
		const openTag = m[0];
		const typeMatch =
			/\bdata-assign-type\s*=\s*"(assignee|delegate)"/i.exec(openTag);
		if (!typeMatch) continue;
		const type = (typeMatch[1] ?? "").toLowerCase();
		if (type !== "assignee") continue;
		const slugMatch = /\bdata-member-slug\s*=\s*"([^"]+)"/i.exec(openTag);
		if (slugMatch) {
			const slug = (slugMatch[1] ?? "").trim();
			if (slug) return slug;
		}
	}
	return null;
}

function extractAssigneeSlugsFromText(t: string): string[] {
	const slugs: string[] = [];
	const re =
		/<span\b[^>]*\bdata-template-key\s*=\s*"members\.assignee"[^>]*\bdata-member-slug\s*=\s*"([^"]+)"[^>]*>/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(t)) !== null) {
		const slug = (m[1] ?? "").trim();
		if (slug) slugs.push(slug);
	}
	return slugs;
}

function renderAssigneeWrapperForSlug(alias: string): string {
	const isEveryone = alias.trim().toLowerCase() === "everyone";
	const memberType = isEveryone ? "special" : "teamMember";
	const memberName = isEveryone ? "Everyone" : getDisplayNameFromAlias(alias);
	return renderTemplateOnly("members.assignee", {
		memberName,
		memberSlug: alias,
		memberType,
		assignmentState: "active",
	});
}

/**
 * Previously excluded completed/cancelled tasks by checking the status char.
 * Now defers to platform isTaskLine, which matches tasks with ANY status.
 */
function isReassignableTaskLine(line: string): boolean {
	return isTaskLine(line);
}

// ---------- core ----------
export type CascadePorts = { taskIndex?: TaskIndexService };

type NearestUpFn = (
	line0: number,
	aliasMap: (string | null)[]
) => string | null;

type PseudoNode = {
	line: number;
	_parentId: string | null;
	_uniqueId: string;
	children: PseudoNode[];
};

function buildOutlineFromLines(lines: string[]) {
	const byLine = new Map<number, PseudoNode>();
	const byId = new Map<string, PseudoNode>();
	const stack: { line0: number; indent: number }[] = [];
	for (let i = 0; i < lines.length; i++) {
		const s = lines[i];
		if (!isListLine(s)) continue;
		const iw = indentWidth(s);
		while (stack.length && stack[stack.length - 1].indent >= iw)
			stack.pop();
		const parent = stack.length ? stack[stack.length - 1].line0 : null;
		const node: PseudoNode = {
			line: i + 1,
			_parentId: parent != null ? `L${parent}` : null,
			_uniqueId: `L${i}`,
			children: [],
		};
		byLine.set(i, node);
		if (parent != null) {
			const p = byLine.get(parent);
			if (p) p.children.push(node);
		}
		stack.push({ line0: i, indent: iw });
	}
	for (const [, n] of byLine) byId.set(n._uniqueId, n);
	return { byLine, byId };
}

export async function applyAssigneeCascade(
	app: App,
	filePath: string,
	editor: any,
	parentLine0: number,
	oldAlias: string | null,
	newAlias: string | null,
	beforeLines: string[] | null | undefined,
	ports: CascadePorts
): Promise<void> {
	try {
		if (oldAlias === newAlias) return;

		const afterLines = editor.getValue().split(/\r?\n/);

		let fileEntry: any | null = null;
		let byLine: Map<number, PseudoNode> = new Map();
		let byId: Map<string, PseudoNode> = new Map();

		const buildMapsFromIndex = () => {
			if (!ports.taskIndex) return;
			const idx = ports.taskIndex.getSnapshot?.();
			const entry = (idx as any)?.[filePath];
			if (!entry) return;
			fileEntry = entry;

			byLine = new Map<number, PseudoNode>();
			byId = new Map<string, PseudoNode>();
			const collect = (items: any[]) => {
				for (const it of items) {
					const l0 = (it.line ?? 1) - 1;
					const node: PseudoNode = {
						line: (it.line ?? 1) as number,
						_parentId: (it._parentId ?? null) as string | null,
						_uniqueId: (it._uniqueId ?? `L${l0}`) as string,
						children: [],
					};
					byLine.set(l0, node);
					byId.set(node._uniqueId, node);
					if (Array.isArray(it.children)) collect(it.children);
				}
			};
			collect(entry.lists || []);
			const wireChildren = (items: any[]) => {
				for (const it of items) {
					const childNode = byId.get(
						(it._uniqueId ?? `L${(it.line ?? 1) - 1}`) as string
					);
					const parentId = (it._parentId ?? null) as string | null;
					if (childNode && parentId) {
						const parentNode = byId.get(parentId);
						if (parentNode) parentNode.children.push(childNode);
					}
					if (Array.isArray(it.children)) wireChildren(it.children);
				}
			};
			wireChildren(entry.lists || []);
		};

		try {
			if (ports.taskIndex) {
				const af = app.vault.getAbstractFileByPath(filePath);
				if (af && (af as any).extension === "md") {
					await ports.taskIndex.updateFile(af as unknown as TFile);
				}
			}
		} catch {
			/* ignore */
		}
		buildMapsFromIndex();

		// Descendants
		let descendants: number[] = [];
		if (fileEntry && byLine.size > 0 && byLine.has(parentLine0)) {
			const parentItem = byLine.get(parentLine0)!;
			const dfs = (it: PseudoNode) => {
				for (const ch of it.children || []) {
					const l0 = (ch.line ?? 1) - 1;
					descendants.push(l0);
					dfs(ch);
				}
			};
			dfs(parentItem);
		} else {
			const { byLine: byLineLocal, byId: byIdLocal } =
				buildOutlineFromLines(afterLines);
			byLine = byLineLocal;
			byId = byIdLocal;

			if (
				parentLine0 >= 0 &&
				parentLine0 < afterLines.length &&
				isListLine(afterLines[parentLine0])
			) {
				const parentIndent = indentWidth(afterLines[parentLine0]);
				for (let i = parentLine0 + 1; i < afterLines.length; i++) {
					const s = afterLines[i];
					if (!isListLine(s)) {
						const trimmed = (s ?? "").trim();
						if (trimmed.length === 0) continue;
						const iw = indentWidth(s);
						if (iw <= parentIndent) break;
						continue;
					}
					const iw = indentWidth(s);
					if (iw <= parentIndent) break;
					descendants.push(i);
				}
			}
		}

		const before = beforeLines ?? afterLines.slice();

		// Optional: remove delegates when parent cleared/everyone
		if (
			newAlias === null ||
			(typeof newAlias === "string" &&
				newAlias.trim().toLowerCase() === "everyone")
		) {
			const orig = afterLines[parentLine0] ?? "";
			let upd = removeWrappersOfTypeOnLine(orig, "delegate", null);
			if (/<\/mark>\s*$/.test(upd)) upd = upd.replace(/\s*$/, " ");
			if (upd !== orig) {
				afterLines[parentLine0] = upd;
				editor.replaceRange(
					upd,
					{ line: parentLine0, ch: 0 },
					{ line: parentLine0, ch: orig.length }
				);
			}
		}

		const buildExplicitMap = (arr: string[]) =>
			arr.map((ln) =>
				isReassignableTaskLine(ln)
					? getExplicitAssigneeSlugFromText(ln)
					: null
			);

		const explicitAfter: (string | null)[] = buildExplicitMap(afterLines);

		let explicitBefore: (string | null)[] = beforeLines
			? buildExplicitMap(before)
			: explicitAfter.slice();

		// If oldAlias still missing, infer from descendants’ effective "before" by majority vote
		const nearestUpExplicitRaw: NearestUpFn = (l0, map) => {
			let cur = byLine.get(l0) ?? null;
			while (cur) {
				const line0 = (cur.line ?? 1) - 1;
				const v = map[line0];
				if (v) return v;
				const pid = cur._parentId;
				cur = pid ? byId.get(pid) ?? null : null;
			}
			return null;
		};
		const effectiveWith = (map: (string | null)[]) => (l0: number) =>
			map[l0] ?? nearestUpExplicitRaw(l0, map);

		const effBeforeAt = effectiveWith(explicitBefore);
		// const effAfterAt = effectiveWith(explicitAfter);

		if (!oldAlias) {
			const counts = new Map<string, number>();
			for (const d of descendants) {
				const ln = before[d] || "";
				if (!isReassignableTaskLine(ln)) continue;
				const eff = effBeforeAt(d);
				if (!eff) continue;
				counts.set(eff, (counts.get(eff) ?? 0) + 1);
			}
			let best: { slug: string; n: number } | null = null;
			for (const [slug, n] of counts.entries()) {
				if (!best || n > best.n) best = { slug, n };
			}
			if (best) {
				oldAlias = best.slug;
			}
		}

		// Force the parent’s old explicit in the "before" model so prevEff computes correctly
		if (typeof oldAlias === "string" && oldAlias.length > 0) {
			explicitBefore[parentLine0] = oldAlias;
		}

		const nearestUpExplicit: NearestUpFn = (l0, map) => {
			let cur = byLine.get(l0) ?? null;
			while (cur) {
				const line0 = (cur.line ?? 1) - 1;
				const v = map[line0];
				if (v) return v;
				const pid = cur._parentId;
				cur = pid ? byId.get(pid) ?? null : null;
			}
			return null;
		};
		const effectiveBeforeAt = (l0: number): string | null =>
			explicitBefore[l0] ?? nearestUpExplicit(l0, explicitBefore);
		const effectiveAfterAt = (l0: number): string | null =>
			explicitAfter[l0] ?? nearestUpExplicit(l0, explicitAfter);

		// Pass 1: frontier
		const toSetExplicit = new Map<number, string>();
		const depthOf = (l0: number): number => {
			let depth = 0;
			let cur = byLine.get(l0) ?? null;
			while (cur) {
				const p = cur._parentId
					? byId.get(cur._parentId) ?? null
					: null;
				if (!p) break;
				depth++;
				cur = p;
			}
			return depth;
		};

		type Affected = {
			line0: number;
			prevEff: string;
			newEff: string | null;
		};
		const affected: Affected[] = [];
		for (const d of descendants) {
			if (d === parentLine0) continue;
			const ln = afterLines[d] || "";
			if (!isReassignableTaskLine(ln)) continue;
			if (!oldAlias) continue;

			const prevEff = effectiveBeforeAt(d);
			const newEff = effectiveAfterAt(d);

			if (prevEff === oldAlias && newEff !== oldAlias) {
				affected.push({ line0: d, prevEff, newEff });
			}
		}

		affected.sort((a, b) => depthOf(a.line0) - depthOf(b.line0));

		const isDescendantOfAnySelected = (
			line0: number,
			selected: Set<number>
		) => {
			let cur = byLine.get(line0) ?? null;
			while (cur) {
				const p = cur._parentId
					? byId.get(cur._parentId) ?? null
					: null;
				if (p) {
					const pLine0 = (p.line ?? 1) - 1;
					if (selected.has(pLine0)) return true;
				}
				cur = p;
			}
			return false;
		};

		const selectedFrontier = new Set<number>();
		for (const a of affected) {
			if (isDescendantOfAnySelected(a.line0, selectedFrontier)) continue;
			if (typeof oldAlias === "string" && oldAlias.length > 0) {
				selectedFrontier.add(a.line0);
				toSetExplicit.set(a.line0, oldAlias);
				// Ensure deeper nodes inherit this during redundancy pass
				explicitAfter[a.line0] = oldAlias;
			}
		}

		// Pass 2: remove redundant explicits
		const toRemoveExplicit = new Set<number>();
		for (const d of descendants) {
			const ln = afterLines[d] || "";
			if (!isReassignableTaskLine(ln)) continue;

			const explicitD = explicitAfter[d];
			if (!explicitD) continue;

			const saved = explicitAfter[d];
			explicitAfter[d] = null;
			const inherited = nearestUpExplicit(d, explicitAfter);
			explicitAfter[d] = saved;

			if (inherited && inherited === explicitD) {
				const wasAdded = toSetExplicit.has(d);
				if (!wasAdded) toRemoveExplicit.add(d);
			}
		}

		// Apply edits
		for (const [lineNo, alias] of toSetExplicit.entries()) {
			if (!alias) continue;
			const orig = editor.getLine(lineNo) ?? "";
			let updated = removeWrappersOfTypeOnLine(orig, "assignee", null);
			const wrapper = renderAssigneeWrapperForSlug(alias);
			const needsSpace = updated.length > 0 && !/\s$/.test(updated);
			updated = needsSpace
				? `${updated} ${wrapper}`
				: `${updated}${wrapper}`;
			updated = updated.replace(/\s+$/, " ");
			if (updated !== orig) {
				editor.replaceRange(
					updated,
					{ line: lineNo, ch: 0 },
					{ line: lineNo, ch: orig.length }
				);
			}
		}

		for (const lineNo of toRemoveExplicit) {
			const orig = editor.getLine(lineNo) ?? "";
			let updated = removeWrappersOfTypeOnLine(orig, "assignee", null);
			updated = updated.replace(/\s+$/, " ");
			if (updated !== orig) {
				editor.replaceRange(
					updated,
					{ line: lineNo, ch: 0 },
					{ line: lineNo, ch: orig.length }
				);
			}
		}
	} catch (err) {
		console.error(
			"[assignment-cascade] error:",
			(err as any)?.message ?? err
		);
	}
}

// ---------- event wiring (now supports headless) ----------
export function wireTaskAssignmentCascade(
	app: App,
	plugin: Plugin,
	ports?: CascadePorts
) {
	class HeadlessEditor {
		private _lines: string[];
		constructor(lines: string[]) {
			this._lines = lines.slice();
		}
		getValue(): string {
			return this._lines.join("\n");
		}
		getLine(n: number): string {
			return this._lines[n] ?? "";
		}
		// Only supports single-line full replacements used by applyAssigneeCascade
		replaceRange(
			newText: string,
			from: { line: number; ch: number },
			to: { line: number; ch: number }
		) {
			if (from.line !== to.line || from.ch !== 0) {
				// Minimal implementation: clamp to full line
			}
			const lineNo = from.line;
			this._lines[lineNo] = newText;
		}
		dumpLines(): string[] {
			return this._lines.slice();
		}
	}

	const onAssigneeChanged = async (evt: Event) => {
		const ce = evt as CustomEvent<{
			filePath: string;
			parentLine0: number;
			beforeLines?: string[] | null;
			newAssigneeSlug: string | null;
			oldAssigneeSlug?: string | null; // explicit old value from UI dispatcher
		}>;
		const detail = ce?.detail;
		if (!detail) return;

		const { filePath, parentLine0, beforeLines, newAssigneeSlug } = detail;

		try {
			const view =
				app.workspace.getActiveViewOfType(MarkdownView) ?? null;

			// Prefer oldAssigneeSlug passed by dispatcher
			let oldAlias: string | null =
				(detail as any).oldAssigneeSlug ?? null;

			if (view && view.file && view.file.path === filePath) {
				const editor: any = (view as any).editor;
				if (!editor) return;

				const before = beforeLines ?? editor.getValue().split(/\r?\n/);
				const after = editor.getValue().split(/\r?\n/);

				if (!oldAlias) {
					const beforeParent = before[parentLine0] ?? "";
					const afterParent = after[parentLine0] ?? "";
					const beforeSlugs =
						extractAssigneeSlugsFromText(beforeParent);
					const afterSlugs =
						extractAssigneeSlugsFromText(afterParent);
					for (const s of beforeSlugs) {
						if (!afterSlugs.includes(s)) {
							oldAlias = s;
							break;
						}
					}
					if (!oldAlias) {
						oldAlias =
							getExplicitAssigneeSlugFromText(beforeParent);
					}
				}

				await applyAssigneeCascade(
					app,
					filePath,
					editor,
					parentLine0,
					oldAlias,
					newAssigneeSlug,
					beforeLines,
					ports ?? {}
				);
				return;
			}

			// Headless branch: file not open — run cascade over file content directly
			const abs = app.vault.getAbstractFileByPath(filePath);
			if (!(abs instanceof TFile)) return;

			const afterContent = await app.vault.read(abs);
			const afterLines = afterContent.split(/\r?\n/);
			const headlessEditor = new HeadlessEditor(afterLines);

			const before = beforeLines ?? afterLines.slice();
			const beforeParent = before[parentLine0] ?? "";
			if (!oldAlias) {
				// Try to recover old alias from before/after difference
				const beforeSlugs = extractAssigneeSlugsFromText(beforeParent);
				const afterSlugs = extractAssigneeSlugsFromText(
					afterLines[parentLine0] ?? ""
				);
				for (const s of beforeSlugs) {
					if (!afterSlugs.includes(s)) {
						oldAlias = s;
						break;
					}
				}
				if (!oldAlias) {
					oldAlias = getExplicitAssigneeSlugFromText(beforeParent);
				}
			}

			await applyAssigneeCascade(
				app,
				filePath,
				headlessEditor as any,
				parentLine0,
				oldAlias,
				newAssigneeSlug,
				beforeLines,
				ports ?? {}
			);

			const newLines = headlessEditor.dumpLines();
			if (newLines.join("\n") !== afterContent) {
				// Let dashboard suppress double-render
				window.dispatchEvent(
					new CustomEvent("agile:prepare-optimistic-file-change", {
						detail: { filePath },
					})
				);
				await app.vault.modify(abs, newLines.join("\n"));
			}
		} catch (e) {
			new Notice(
				`Assignment cascade failed: ${String(
					(e as Error)?.message ?? e
				)}`
			);
		}
	};

	plugin.registerDomEvent(
		document,
		"agile:assignee-changed" as any,
		onAssigneeChanged as any
	);
}
