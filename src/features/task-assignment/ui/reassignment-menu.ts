import type { App, Plugin } from "obsidian";
import { MarkdownView, Notice, Menu, TFile } from "obsidian";
import { renderTemplateOnly } from "@features/templating";
import type {
	OrgStructurePort,
	MemberInfo,
	MembersBuckets,
} from "@features/org-structure";
import { classifyMember } from "@features/org-structure";
import {
	findAssignmentWrappersOnLine,
	removeWrappersOfTypeOnLine,
	replaceWrapperInstanceOnLine,
} from "../app/assignment-inline-utils";
import { getDisplayNameFromAlias } from "@shared/identity";
import { AddMemberModal, type AddMemberKind } from "../ui/add-member-modal";

type AssignType = "assignee" | "delegate";

function toTitleCase(s: string) {
	return s.replace(
		/\S+/g,
		(w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
	);
}

function getActiveView(app: App): MarkdownView | null {
	return app.workspace.getActiveViewOfType(MarkdownView) ?? null;
}

// Robust attribute matcher (supports ' or ")
function hasAttrWithValue(s: string, attr: string, value: string): boolean {
	const esc = String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const re = new RegExp(`\\b${attr}\\s*=\\s*(['"])${esc}\\1`, "i");
	return re.test(s);
}

function findLineIndexByInstanceIdInEditor(
	editor: any,
	instanceId: string
): number {
	try {
		const raw = editor.getValue() ?? "";
		const lines = raw.split(/\r?\n/);
		for (let i = 0; i < lines.length; i++) {
			if (hasAttrWithValue(lines[i], "data-template-wrapper", instanceId))
				return i;
		}
	} catch {
		/* ignore */
	}
	return -1;
}

function findLineIndexByInstanceIdInLines(
	lines: string[],
	instanceId: string
): number {
	for (let i = 0; i < lines.length; i++) {
		if (hasAttrWithValue(lines[i], "data-template-wrapper", instanceId))
			return i;
	}
	return -1;
}

/**
 * Map org-structure member kind to templating "Members.assignee" memberType.
 */
function mapMemberKindToAssigneeType(
	kind: "member" | "internal-team-member" | "team" | "external"
): "teamMember" | "delegateTeam" | "delegateTeamMember" | "delegateExternal" {
	switch (kind) {
		case "member":
			return "teamMember";
		case "team":
			return "delegateTeam";
		case "internal-team-member":
			return "delegateTeamMember";
		case "external":
			return "delegateExternal";
	}
}

function buildAssignmentTargets(
	members: MemberInfo[],
	_buckets: MembersBuckets
) {
	const out: Array<{
		memberName: string;
		memberSlug: string;
		memberLabel: string;
		memberType:
			| "teamMember"
			| "delegateTeam"
			| "delegateTeamMember"
			| "delegateExternal";
	}> = [];

	for (const m of members) {
		const c = classifyMember(m);
		const display =
			getDisplayNameFromAlias(m.alias ?? "") ||
			m.name?.trim() ||
			m.alias?.trim() ||
			"";
		out.push({
			memberName: display,
			memberSlug: (m.alias ?? "").trim(),
			memberLabel: c.label,
			memberType: mapMemberKindToAssigneeType(c.kind),
		});
	}

	return out;
}

function placeCursorEndOfLine(editor: any, lineNo: number, lineText: string) {
	try {
		editor.setCursor?.({ line: lineNo, ch: lineText.length });
	} catch {
		/* ignore */
	}
}

function updateEditorLine(editor: any, lineNo: number, newText: string) {
	const before = editor.getLine(lineNo) ?? "";
	editor.replaceRange(
		newText,
		{ line: lineNo, ch: 0 },
		{ line: lineNo, ch: before.length }
	);
	placeCursorEndOfLine(editor, lineNo, newText);
}

// Resolve the preferred DOM target for events (content root) plus global fallback
function getEventTargets(app: App, view: MarkdownView | null): EventTarget[] {
	const targets: EventTarget[] = [];

	// IMPORTANT: include window so the Agile Dashboard (listening on window) sees the event
	const win: EventTarget | null =
		typeof window !== "undefined"
			? (window as unknown as EventTarget)
			: null;
	if (win) targets.push(win);

	const globalDoc = (window as any)?.document ?? document;
	if (globalDoc) targets.push(globalDoc);

	const cmHolder = (view ?? getActiveView(app)) as unknown as {
		editor?: { cm?: { contentDOM?: HTMLElement } };
	};
	const cmContent =
		cmHolder?.editor?.cm?.contentDOM ??
		(view ?? getActiveView(app))?.containerEl?.querySelector?.(
			".cm-content"
		) ??
		null;
	if (cmContent) targets.unshift(cmContent as EventTarget);
	return targets;
}

function kindToMemberType(
	kind: AddMemberKind
): "teamMember" | "delegateTeam" | "delegateTeamMember" | "delegateExternal" {
	switch (kind) {
		case "member":
			return "teamMember";
		case "team":
			return "delegateTeam";
		case "internal-team-member":
			return "delegateTeamMember";
		case "external":
			return "delegateExternal";
	}
}

/**
 * Headless helpers: read/modify/write the file without opening a tab.
 */
async function readFileLines(
	app: App,
	filePath: string
): Promise<{ file: TFile; lines: string[] }> {
	const abs = app.vault.getAbstractFileByPath(filePath);
	if (!(abs instanceof TFile)) throw new Error(`File not found: ${filePath}`);
	const content = await app.vault.read(abs);
	return { file: abs, lines: content.split(/\r?\n/) };
}

async function writeFileLines(
	app: App,
	file: TFile,
	lines: string[]
): Promise<void> {
	await app.vault.modify(file, lines.join("\n"));
}

/**
 * Extract current assignee slug from a wrapper segment.
 */
function extractSlugFromWrapperSegment(segment: string): string | null {
	const m = /data-member-slug\s*=\s*['"]([^'"]+)['"]/i.exec(segment);
	return m ? (m[1] ?? "").trim() || null : null;
}

function generateWrapperId(): string {
	return `agile-assignee-${Date.now().toString(36)}-${Math.random()
		.toString(36)
		.slice(2, 8)}`;
}

function findNearbyCandidateLine(
	lines: string[],
	hint0: number,
	assignType: AssignType,
	currentSlug: string
): number {
	const inRange = (i: number) => i >= 0 && i < lines.length;

	const hasWrapperOfType = (s: string) =>
		/\bdata-template-key\s*=\s*['"]members\.assignee['"]/i.test(s) &&
		new RegExp(
			`\\bdata-assign-type\\s*=\\s*['"](?!\\s)${assignType}['"]`,
			"i"
		).test(s);

	const hasSlug = (s: string) =>
		currentSlug
			? new RegExp(
					`\\bdata-member-slug\\s*=\\s*['"]${currentSlug.replace(
						/[-/\\^$*+?.()|[\]{}]/g,
						"\\$&"
					)}['"]`,
					"i"
			  ).test(s)
			: true;

	// Prefer exact type+slug within ±5
	const order: number[] = [];
	for (let d = 0; d <= 5; d++) {
		if (d === 0) order.push(hint0);
		else {
			order.push(hint0 - d, hint0 + d);
		}
	}
	for (const i of order) {
		if (!inRange(i)) continue;
		const s = lines[i] ?? "";
		if (hasWrapperOfType(s) && hasSlug(s)) return i;
	}
	// Next, type-only in the same neighborhood
	for (const i of order) {
		if (!inRange(i)) continue;
		const s = lines[i] ?? "";
		if (hasWrapperOfType(s)) return i;
	}
	// Fallback: first line in file with wrapper of type
	for (let i = 0; i < lines.length; i++) {
		if (hasWrapperOfType(lines[i] ?? "")) return i;
	}
	return -1;
}

type MenuMode = "editor" | "headless";

type OpenMenuParams = {
	mode?: MenuMode | "auto";
	app: App;
	plugin?: Plugin | null;
	ports: { orgStructure: OrgStructurePort };
	at: { x: number; y: number };
	filePath: string;
	instanceId: string;
	assignType: AssignType;
	currentState: "active" | "inactive";
	currentSlug: string;

	// dashboard context hints for robustness and localized refresh
	parentUid?: string | null;
	lineHint0?: number | null;
};

/**
 * Exported entry point: open the reassignment menu at a position, for either editor or headless modes.
 */
export function openAssignmentMenuAt(params: OpenMenuParams) {
	const {
		mode = "auto",
		app,
		ports,
		at,
		filePath,
		instanceId,
		assignType,
		currentSlug,
		currentState,
		parentUid = null,
		lineHint0 = null,
	} = params;

	const view = getActiveView(app);
	const editor: any =
		view && view.file && view.file.path === filePath
			? (view as any)?.editor
			: null;

	const effectiveMode: MenuMode =
		mode === "auto" ? (editor ? "editor" : "headless") : (mode as MenuMode);

	const { members, buckets, team } =
		ports.orgStructure.getTeamMembersForFile(filePath);
	const targets = buildAssignmentTargets(members, buckets);

	const isAssignee = assignType === "assignee";
	const isDelegate = assignType === "delegate";

	const menu = new Menu();

	const stateOpposite = currentState === "active" ? "inactive" : "active";

	// Helpers to dispatch cascade with a true pre-mutation snapshot.
	const dispatchCascade = (
		beforeDoc: string[],
		lineNo: number,
		oldAssigneeSlug: string | null,
		newAssigneeSlug: string | null
	) => {
		const targetsEls = getEventTargets(app, view);
		const detail: any = {
			filePath,
			parentLine0: lineNo,
			beforeLines: beforeDoc,
			newAssigneeSlug,
			oldAssigneeSlug,
		};
		if (parentUid) detail.parentUid = parentUid;

		for (const t of targetsEls) {
			try {
				(t as any).dispatchEvent?.(
					new CustomEvent("agile:assignee-changed", {
						detail,
					})
				);
			} catch {
				/* ignore */
			}
		}
	};

	const ensureWrapperId = (html: string, desiredId?: string | null) => {
		const keepId = desiredId || generateWrapperId();
		if (/\bdata-template-wrapper\s*=/.test(html)) {
			return html.replace(
				/\bdata-template-wrapper\s*=\s*['"][^'"]*['"]/,
				`data-template-wrapper="${keepId}"`
			);
		}
		// As a guard, add if missing (shouldn't happen for template)
		return html.replace(
			/^<span/i,
			`<span data-template-wrapper="${keepId}"`
		);
	};

	const replaceOnLineByType = (
		line: string,
		newHtml: string,
		type: AssignType,
		preferredInstance?: string | null,
		preferredSlug?: string | null
	): { updated: string; keptInstanceId: string } => {
		const wrappers = findAssignmentWrappersOnLine(line);
		let target =
			(preferredInstance &&
				wrappers.find((w) => w.instanceId === preferredInstance)) ||
			(preferredSlug &&
				wrappers.find(
					(w) =>
						w.assignType === type &&
						extractSlugFromWrapperSegment(
							w.segment || ""
						)?.toLowerCase() === preferredSlug.toLowerCase()
				)) ||
			wrappers.find((w) => w.assignType === type) ||
			null;

		let keepId = target?.instanceId || null;
		let patched = ensureWrapperId(newHtml, keepId);
		const m = /data-template-wrapper\s*=\s*['"]([^'"]+)['"]/i.exec(patched);
		keepId = m ? m[1] : generateWrapperId();
		patched = ensureWrapperId(patched, keepId);

		let updated: string;
		if (target) {
			updated =
				line.slice(0, target.start) + patched + line.slice(target.end);
		} else {
			const needsSpace = line.length > 0 && !/\s$/.test(line);
			updated = (
				needsSpace ? `${line} ${patched}` : `${line}${patched}`
			).replace(/\s+$/, " ");
		}
		updated = removeWrappersOfTypeOnLine(updated, type, keepId);
		updated = updated.replace(/\s+$/, " ");
		return { updated, keptInstanceId: keepId };
	};

	// Build operations for each mode
	const ops = {
		async replaceInEditor(args: {
			memberName: string;
			memberSlug: string;
			memberType:
				| "teamMember"
				| "delegateTeam"
				| "delegateTeamMember"
				| "delegateExternal"
				| "special";
			nextState: "active" | "inactive";
		}) {
			if (!editor) return;

			// Try instanceId -> neighborhood hint -> global fallback
			let lineNo = findLineIndexByInstanceIdInEditor(editor, instanceId);
			{
				const raw = editor.getValue() ?? "";
				const lines = raw.split(/\r?\n/);
				if (lineNo < 0) {
					const hint =
						typeof lineHint0 === "number"
							? Math.max(0, Math.min(lines.length - 1, lineHint0))
							: 0;
					lineNo = findNearbyCandidateLine(
						lines,
						hint,
						assignType,
						currentSlug
					);
				}
				if (lineNo < 0) return;
			}

			const beforeLine = editor.getLine(lineNo) ?? "";
			const beforeDoc = (editor.getValue() ?? "").split(/\r?\n/);

			// Extract previous assignee slug (best effort)
			let oldSlug: string | null = null;
			{
				const wrappers = findAssignmentWrappersOnLine(beforeLine);
				const target = wrappers.find(
					(w) => w.instanceId === instanceId
				);
				oldSlug =
					(target?.assignType === "assignee"
						? extractSlugFromWrapperSegment(target?.segment || "")
						: null) || null;
				if (!oldSlug) {
					const near =
						wrappers.find(
							(w) =>
								w.assignType === "assignee" &&
								extractSlugFromWrapperSegment(
									w.segment || ""
								)?.toLowerCase() === currentSlug.toLowerCase()
						) ||
						wrappers.find((w) => w.assignType === "assignee") ||
						null;
					if (near) {
						oldSlug =
							extractSlugFromWrapperSegment(near.segment || "") ||
							null;
					}
				}
			}

			const display =
				args.memberType === "special"
					? args.memberName
					: getDisplayNameFromAlias(args.memberSlug) ||
					  args.memberName;

			let newHtml = renderTemplateOnly("members.assignee", {
				memberName: display,
				memberSlug: args.memberSlug,
				memberType: args.memberType,
				assignmentState: args.nextState,
			});

			// If we can preserve the instance, do so
			const wrappers = findAssignmentWrappersOnLine(beforeLine);
			const target =
				wrappers.find((w) => w.instanceId === instanceId) || null;

			let updated: string;
			if (target) {
				newHtml = ensureWrapperId(newHtml, instanceId);
				updated = replaceWrapperInstanceOnLine(
					beforeLine,
					instanceId,
					newHtml
				);
				updated = removeWrappersOfTypeOnLine(
					updated,
					assignType,
					instanceId
				);
				updated = updated.replace(/\s+$/, " ");
			} else {
				const res = replaceOnLineByType(
					beforeLine,
					newHtml,
					assignType,
					null,
					currentSlug || null
				);
				updated = res.updated;
			}

			updateEditorLine(editor, lineNo, updated);

			if (isAssignee) {
				const beforeDocForEvent = beforeDoc.map(
					(s: string, i: number) => (i === lineNo ? beforeLine : s)
				);
				dispatchCascade(
					beforeDocForEvent,
					lineNo,
					oldSlug,
					args.memberSlug
				);
			}
		},

		async removeInEditor() {
			if (!editor) return;

			let lineNo = findLineIndexByInstanceIdInEditor(editor, instanceId);
			{
				const raw = editor.getValue() ?? "";
				const lines = raw.split(/\r?\n/);
				if (lineNo < 0) {
					const hint =
						typeof lineHint0 === "number"
							? Math.max(0, Math.min(lines.length - 1, lineHint0))
							: 0;
					lineNo = findNearbyCandidateLine(
						lines,
						hint,
						assignType,
						currentSlug
					);
				}
				if (lineNo < 0) return;
			}

			const before = editor.getLine(lineNo) ?? "";
			const beforeDoc = (editor.getValue() ?? "").split(/\r?\n/);

			const wrappers = findAssignmentWrappersOnLine(before);
			const target =
				wrappers.find((w) => w.instanceId === instanceId) ||
				wrappers.find(
					(w) =>
						w.assignType === assignType &&
						extractSlugFromWrapperSegment(
							w.segment || ""
						)?.toLowerCase() === currentSlug.toLowerCase()
				) ||
				wrappers.find((w) => w.assignType === assignType) ||
				null;

			const oldSlug =
				(target?.assignType === "assignee"
					? extractSlugFromWrapperSegment(target?.segment || "")
					: null) || null;

			if (!target) return;

			let updated =
				before.slice(0, target.start) + before.slice(target.end);
			updated = updated.replace(/ {2,}/g, " ").replace(/\s+$/, " ");

			updateEditorLine(editor, lineNo, updated);

			if (isAssignee) {
				dispatchCascade(beforeDoc, lineNo, oldSlug, null);
			}
		},

		async replaceHeadless(args: {
			memberName: string;
			memberSlug: string;
			memberType:
				| "teamMember"
				| "delegateTeam"
				| "delegateTeamMember"
				| "delegateExternal"
				| "special";
			nextState: "active" | "inactive";
		}) {
			const { file, lines } = await readFileLines(app, filePath);
			const beforeDoc = lines.slice();

			// Try instanceId -> neighborhood hint (if any) -> global fallback
			let lineNo = findLineIndexByInstanceIdInLines(lines, instanceId);
			if (lineNo < 0) {
				const hint =
					typeof lineHint0 === "number"
						? Math.max(0, Math.min(lines.length - 1, lineHint0))
						: 0;
				lineNo = findNearbyCandidateLine(
					lines,
					hint,
					assignType,
					currentSlug
				);
			}
			if (lineNo < 0) return;

			const beforeLine = lines[lineNo] ?? "";

			// Extract old slug from clicked/near wrapper in line
			let oldSlug: string | null = null;
			{
				const wrappers = findAssignmentWrappersOnLine(beforeLine);
				const target =
					wrappers.find((w) => w.instanceId === instanceId) ||
					wrappers.find(
						(w) =>
							w.assignType === "assignee" &&
							extractSlugFromWrapperSegment(
								w.segment || ""
							)?.toLowerCase() === currentSlug.toLowerCase()
					) ||
					wrappers.find((w) => w.assignType === "assignee") ||
					null;
				if (target) {
					oldSlug =
						extractSlugFromWrapperSegment(target.segment || "") ||
						null;
				}
			}

			const display =
				args.memberType === "special"
					? args.memberName
					: getDisplayNameFromAlias(args.memberSlug) ||
					  args.memberName;

			let newHtml = renderTemplateOnly("members.assignee", {
				memberName: display,
				memberSlug: args.memberSlug,
				memberType: args.memberType,
				assignmentState: args.nextState,
			});

			let updated: string;
			const present = hasAttrWithValue(
				beforeLine,
				"data-template-wrapper",
				instanceId
			);
			if (present) {
				newHtml = ensureWrapperId(newHtml, instanceId);
				updated = replaceWrapperInstanceOnLine(
					beforeLine,
					instanceId,
					newHtml
				);
				updated = removeWrappersOfTypeOnLine(
					updated,
					assignType,
					instanceId
				);
				updated = updated.replace(/\s+$/, " ");
			} else {
				const res = replaceOnLineByType(
					beforeLine,
					newHtml,
					assignType,
					null,
					currentSlug || null
				);
				updated = res.updated;
			}

			if (updated !== beforeLine) {
				// Notify dashboard to suppress double-render
				window.dispatchEvent(
					new CustomEvent("agile:prepare-optimistic-file-change", {
						detail: { filePath },
					})
				);
				lines[lineNo] = updated;
				await writeFileLines(app, file, lines);
			}

			if (isAssignee) {
				dispatchCascade(beforeDoc, lineNo, oldSlug, args.memberSlug);
			}
		},

		async removeHeadless() {
			const { file, lines } = await readFileLines(app, filePath);
			const beforeDoc = lines.slice();

			let lineNo = findLineIndexByInstanceIdInLines(lines, instanceId);
			if (lineNo < 0) {
				const hint =
					typeof lineHint0 === "number"
						? Math.max(0, Math.min(lines.length - 1, lineHint0))
						: 0;
				lineNo = findNearbyCandidateLine(
					lines,
					hint,
					assignType,
					currentSlug
				);
			}
			if (lineNo < 0) return;

			const beforeLine = lines[lineNo] ?? "";
			const wrappers = findAssignmentWrappersOnLine(beforeLine);
			const target =
				wrappers.find((w) => w.instanceId === instanceId) ||
				wrappers.find(
					(w) =>
						w.assignType === assignType &&
						extractSlugFromWrapperSegment(
							w.segment || ""
						)?.toLowerCase() === currentSlug.toLowerCase()
				) ||
				wrappers.find((w) => w.assignType === assignType) ||
				null;

			const oldSlug =
				(target?.assignType === "assignee"
					? extractSlugFromWrapperSegment(target?.segment || "")
					: null) || null;

			if (!target) return;

			let updated =
				beforeLine.slice(0, target.start) +
				beforeLine.slice(target.end);
			updated = updated.replace(/ {2,}/g, " ").replace(/\s+$/, " ");

			if (updated !== beforeLine) {
				window.dispatchEvent(
					new CustomEvent("agile:prepare-optimistic-file-change", {
						detail: { filePath },
					})
				);
				lines[lineNo] = updated;
				await writeFileLines(app, file, lines);
			}

			if (isAssignee) {
				dispatchCascade(beforeDoc, lineNo, oldSlug, null);
			}
		},
	};

	// Footer: New Member items
	const queueNewMemberItem = (nextState: "active" | "inactive") => {
		menu.addItem((i) => {
			const title = `New Member (${toTitleCase(nextState)})`;
			i.setTitle(title);
			i.onClick(() => {
				const teamName = team?.name ?? "Team";
				const existingMembers = (members ?? []) as MemberInfo[];
				const allTeams: string[] = []; // no global list available here
				const internalTeamCodes = new Map<string, string>();
				const submitButtonText =
					assignType === "assignee"
						? "Assign to New Member"
						: "Delegate to New Member";
				const allowedTypes =
					assignType === "assignee"
						? (["member"] as const)
						: (["external", "existing"] as const);

				new AddMemberModal(
					app,
					teamName,
					allTeams,
					existingMembers,
					internalTeamCodes,
					async (memberName, memberAlias, selectedKind) => {
						const memberType =
							assignType === "assignee"
								? "teamMember"
								: kindToMemberType(selectedKind);

						if (effectiveMode === "editor") {
							await ops.replaceInEditor({
								memberName,
								memberSlug: memberAlias,
								memberType,
								nextState,
							});
						} else {
							await ops.replaceHeadless({
								memberName,
								memberSlug: memberAlias,
								memberType,
								nextState,
							});
						}
					},
					{
						submitButtonText,
						allowedTypes: [...allowedTypes],
						titleText:
							assignType === "assignee"
								? "Assign to New Member"
								: "Delegate to New Member",
					}
				).open();
			});
		});
	};

	// Footer: Remove item
	const queueRemoveItem = () => {
		menu.addItem((i) => {
			i.setTitle(isAssignee ? "Remove Assignee" : "Remove Delegate");
			i.onClick(async () => {
				if (effectiveMode === "editor") {
					await ops.removeInEditor();
				} else {
					await ops.removeHeadless();
				}
			});
		});
	};

	// Helper for adding assignment options
	const addAssignItem = (
		title: string,
		memberName: string,
		memberSlug: string,
		memberType:
			| "teamMember"
			| "delegateTeam"
			| "delegateTeamMember"
			| "delegateExternal"
			| "special",
		nextState: "active" | "inactive"
	) => {
		menu.addItem((i) => {
			i.setTitle(title);
			i.onClick(async () => {
				if (effectiveMode === "editor") {
					await ops.replaceInEditor({
						memberName,
						memberSlug,
						memberType,
						nextState,
					});
				} else {
					await ops.replaceHeadless({
						memberName,
						memberSlug,
						memberType,
						nextState,
					});
				}
			});
		});
	};

	// MAIN LIST: assignees first (team members)
	if (isAssignee) {
		for (const t of targets) {
			if (t.memberType !== "teamMember") continue;
			const display =
				getDisplayNameFromAlias(t.memberSlug) ||
				toTitleCase(t.memberName || t.memberSlug || "");
			if (t.memberSlug.toLowerCase() === currentSlug.toLowerCase()) {
				addAssignItem(
					`${display} (${toTitleCase(stateOpposite)})`,
					display,
					t.memberSlug,
					t.memberType,
					stateOpposite
				);
			} else {
				addAssignItem(
					`${display} (Active)`,
					display,
					t.memberSlug,
					t.memberType,
					"active"
				);
				addAssignItem(
					`${display} (Inactive)`,
					display,
					t.memberSlug,
					t.memberType,
					"inactive"
				);
			}
		}

		// SPECIAL ASSIGNEES
		type SpecialCandidate = { name: string; slug: string };
		const specialsMap = new Map<string, SpecialCandidate>();

		if (team) {
			specialsMap.set("everyone", { name: "Everyone", slug: "everyone" });
		}
		try {
			const getSpecials = (ports.orgStructure as any)
				?.getSpecialAssigneesForFile;
			if (typeof getSpecials === "function") {
				const extra: any = getSpecials.call(
					ports.orgStructure,
					filePath
				);
				if (Array.isArray(extra)) {
					for (const e of extra) {
						const slug = String(e?.slug ?? "").trim();
						if (!slug) continue;
						const key = slug.toLowerCase();
						const name =
							String(e?.name ?? "").trim() ||
							toTitleCase(slug.replace(/[-_]+/g, " "));
						if (!specialsMap.has(key)) {
							specialsMap.set(key, { name, slug });
						}
					}
				}
			}
		} catch {
			/* ignore optional specials discovery */
		}

		const specialsSorted = Array.from(specialsMap.values()).sort((a, b) =>
			a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
		);

		for (const s of specialsSorted) {
			const isCurrent =
				s.slug.toLowerCase() === currentSlug.toLowerCase();
			const nameForTitle = s.name;
			if (isCurrent) {
				addAssignItem(
					`${nameForTitle} (${toTitleCase(stateOpposite)})`,
					nameForTitle,
					s.slug,
					"special",
					stateOpposite
				);
			} else {
				addAssignItem(
					`${nameForTitle} (Active)`,
					nameForTitle,
					s.slug,
					"special",
					"active"
				);
				addAssignItem(
					`${nameForTitle} (Inactive)`,
					nameForTitle,
					s.slug,
					"special",
					"inactive"
				);
			}
		}
	}

	// Delegates list
	if (isDelegate) {
		const delegateTargets = targets.filter(
			(t) =>
				t.memberType === "delegateTeam" ||
				t.memberType === "delegateTeamMember" ||
				t.memberType === "delegateExternal"
		);

		for (const t of delegateTargets) {
			const display =
				getDisplayNameFromAlias(t.memberSlug) ||
				toTitleCase(t.memberName || t.memberSlug || "");
			const labelWithType = `${display} (${t.memberLabel})`;
			if (t.memberSlug.toLowerCase() === currentSlug.toLowerCase()) {
				addAssignItem(
					`${labelWithType} (${toTitleCase(stateOpposite)})`,
					display,
					t.memberSlug,
					t.memberType,
					stateOpposite
				);
			} else {
				addAssignItem(
					`${labelWithType} (Active)`,
					display,
					t.memberSlug,
					t.memberType,
					"active"
				);
				addAssignItem(
					`${labelWithType} (Inactive)`,
					display,
					t.memberSlug,
					t.memberType,
					"inactive"
				);
			}
		}
	}

	// Footer
	queueNewMemberItem("active");
	queueNewMemberItem("inactive");
	queueRemoveItem();

	menu.showAtPosition({ x: at.x, y: at.y });
}

/**
 * Editor-only handler (existing behavior): wires clicks inside a MarkdownView.
 */
export function wireTaskAssignmentDomHandlers(
	app: App,
	view: MarkdownView,
	plugin: Plugin,
	ports: { orgStructure: OrgStructurePort }
) {
	const cmHolder = view as unknown as {
		editor?: { cm?: { contentDOM?: HTMLElement } };
	};
	const cmContent = cmHolder.editor?.cm?.contentDOM;
	const contentRoot = (cmContent ??
		view.containerEl.querySelector(".cm-content")) as HTMLElement | null;
	const targetEl: HTMLElement = contentRoot ?? view.containerEl;

	const onClick = (evt: MouseEvent) => {
		const el = (evt.target as HTMLElement | null)?.closest(
			'span[data-template-key="members.assignee"]'
		) as HTMLElement | null;
		if (!el) return;

		evt.preventDefault();
		evt.stopPropagation();
		// @ts-ignore
		(evt as any).stopImmediatePropagation?.();

		try {
			const templateKey = el.getAttribute("data-template-key") ?? "";
			if (templateKey !== "members.assignee") return;

			const instanceId = el.getAttribute("data-template-wrapper") ?? "";
			if (!instanceId) return;

			const assignTypeAttr = (
				el.getAttribute("data-assign-type") || ""
			).toLowerCase();
			const assignType: AssignType =
				assignTypeAttr === "delegate" ? "delegate" : "assignee";

			const currentState = (
				(
					el.getAttribute("data-assignment-state") || ""
				).toLowerCase() === "inactive"
					? "inactive"
					: "active"
			) as "active" | "inactive";

			const currentSlug = (
				el.getAttribute("data-member-slug") || ""
			).trim();

			const viewNow = getActiveView(app);
			if (!viewNow) return;
			const filePath = viewNow.file?.path ?? "";
			if (!filePath) return;

			openAssignmentMenuAt({
				mode: "editor",
				app,
				plugin,
				ports,
				at: { x: evt.clientX, y: evt.clientY },
				filePath,
				instanceId,
				assignType,
				currentState,
				currentSlug,
			});
		} catch (err) {
			new Notice(
				`Assignment menu failed: ${String(
					(err as Error)?.message ?? err
				)}`
			);
		}
	};

	plugin.registerDomEvent(targetEl, "click", onClick, { capture: true });
}
