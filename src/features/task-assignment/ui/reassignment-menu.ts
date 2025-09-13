import type { App, Plugin } from "obsidian";
import { MarkdownView, Notice, Menu } from "obsidian";
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
import {
	AddMemberModal,
	type AddMemberKind,
} from "../ui/add-member-modal";

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

function findLineIndexByInstanceId(editor: any, instanceId: string): number {
	try {
		const raw = editor.getValue() ?? "";
		const lines = raw.split(/\r?\n/);
		const needle = `data-template-wrapper="${instanceId}"`;
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].includes(needle)) return i;
		}
	} catch {
		// ignore
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
		// Use display name from alias
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
		// ignore
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
 * Inserts menu items for all options appropriate to the clicked wrapper.
 */
function buildMenuForAssignment(
	menu: Menu,
	params: {
		assignType: AssignType;
		currentSlug: string;
		currentState: "active" | "inactive";
		instanceId: string;
		filePath: string;
		app: App;
		plugin: Plugin;
		ports: { orgStructure: OrgStructurePort };
	}
) {
	const {
		assignType,
		currentSlug,
		currentState,
		instanceId,
		filePath,
		app,
		ports,
	} = params;
	const view = getActiveView(app);
	const editor: any = (view as any)?.editor;
	if (!view || !editor) return;

	const { members, buckets, team } =
		ports.orgStructure.getTeamMembersForFile(filePath);
	const targets = buildAssignmentTargets(members, buckets);

	const isAssignee = assignType === "assignee";
	const isDelegate = assignType === "delegate";

	// New Member options (first)
	const addNewMemberItem = (nextState: "active" | "inactive") => {
		const title =
			assignType === "assignee"
				? `New Member (${toTitleCase(nextState)})`
				: `New Member (${toTitleCase(nextState)})`;
		menu.addItem((i) => {
			i.setTitle(title);
			i.onClick(() => {
				// Build modal sources from current context
				const teamName = team?.name ?? "Team";
				const existingMembers = (members ?? []) as MemberInfo[];
				const allTeams: string[] = []; // No global list available here
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
						const lineNo = findLineIndexByInstanceId(
							editor,
							instanceId
						);
						if (lineNo < 0) return;

						const before = editor.getLine(lineNo) ?? "";
						const beforeDoc = (editor.getValue() ?? "").split(
							/\r?\n/
						);

						// Determine memberType for the wrapper
						const memberType =
							assignType === "assignee"
								? "teamMember"
								: kindToMemberType(selectedKind);

						// Render wrapper HTML
						let newHtml = renderTemplateOnly("members.assignee", {
							memberName,
							memberSlug: memberAlias,
							memberType,
							assignmentState: nextState,
						});

						// Preserve instanceId
						newHtml = newHtml.replace(
							/data-template-wrapper="[^"]*"/,
							`data-template-wrapper="${instanceId}"`
						);

						// Replace clicked wrapper
						let updated = replaceWrapperInstanceOnLine(
							before,
							instanceId,
							newHtml
						);

						// Remove other wrappers of the same type on the same line (keep our instance)
						updated = removeWrappersOfTypeOnLine(
							updated,
							assignType,
							instanceId
						);

						updated = updated.replace(/\s+$/, " ");
						updateEditorLine(editor, lineNo, updated);

						// Cascade only for assignee
						if (assignType === "assignee") {
							const targetsEls = getEventTargets(app, view);
							const detail = {
								filePath,
								parentLine0: lineNo,
								beforeLines: beforeDoc.map(
									(s: string, idx: number) =>
										idx === lineNo ? before : s
								),
								newAssigneeSlug: memberAlias,
								oldAssigneeSlug:
									/data-member-slug="([^"]+)"/.exec(
										before
									)?.[1] ?? null,
							};
							for (const t of targetsEls) {
								try {
									(t as any).dispatchEvent?.(
										new CustomEvent(
											"agile:assignee-changed",
											{
												detail,
											}
										)
									);
								} catch {}
							}
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

	addNewMemberItem("active");
	addNewMemberItem("inactive");

	// Remove item
	menu.addItem((i) => {
		i.setTitle(isAssignee ? "Remove Assignee" : "Remove Delegate");
		i.onClick(() => {
			const lineNo = findLineIndexByInstanceId(editor, instanceId);
			if (lineNo < 0) return;
			const before = editor.getLine(lineNo) ?? "";

			// Capture true pre-mutation snapshot and old slug from the clicked wrapper
			const beforeDoc = (editor.getValue() ?? "").split(/\r?\n/);
			const wrappers = findAssignmentWrappersOnLine(before);
			const target = wrappers.find((w) => w.instanceId === instanceId);
			const oldSlug =
				(target?.assignType === "assignee"
					? /data-member-slug="([^"]+)"/.exec(
							target?.segment || ""
					  )?.[1]
					: null) || null;

			// Remove this wrapper instance; keep others (including the other assign type)
			if (!target) return;
			let updated =
				before.slice(0, target.start) + before.slice(target.end);
			// Normalize spaces
			updated = updated.replace(/ {2,}/g, " ").replace(/\s+$/, " ");
			updateEditorLine(editor, lineNo, updated);

			// If we removed an assignee wrapper, emit cascade with pre-mutation state + explicit oldAssigneeSlug
			if (isAssignee) {
				const targetsEls = getEventTargets(app, view);
				const detail = {
					filePath: filePath,
					parentLine0: lineNo,
					beforeLines: beforeDoc, // true pre-mutation doc
					newAssigneeSlug: null, // cleared
					oldAssigneeSlug: oldSlug, // explicit from clicked wrapper
				};
				for (const t of targetsEls) {
					try {
						(t as any).dispatchEvent?.(
							new CustomEvent("agile:assignee-changed", {
								detail,
							})
						);
					} catch {}
				}
			}
		});
	});

	// Convenience helpers for existing members
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
			i.onClick(() => {
				const lineNo = findLineIndexByInstanceId(editor, instanceId);
				if (lineNo < 0) return;

				// Build the new assignee HTML using the display name. For "everyone", enforce special.
				const isEveryone =
					memberType === "special" ||
					memberSlug.trim().toLowerCase() === "everyone";
				const displayName = isEveryone
					? "Everyone"
					: getDisplayNameFromAlias(memberSlug) || memberName;

				let newHtml = renderTemplateOnly("members.assignee", {
					memberName: displayName,
					memberSlug: memberSlug,
					memberType: isEveryone ? "special" : memberType,
					assignmentState: nextState,
				});

				// Preserve original instanceId
				newHtml = newHtml.replace(
					/data-template-wrapper="[^"]*"/,
					`data-template-wrapper="${instanceId}"`
				);

				const before = editor.getLine(lineNo) ?? "";
				const beforeDoc = (editor.getValue() ?? "").split(/\r?\n/);

				// Extract old slug from the clicked wrapper before we replace it
				const wrappers = findAssignmentWrappersOnLine(before);
				const target = wrappers.find(
					(w) => w.instanceId === instanceId
				);
				const oldSlug =
					(target?.assignType === "assignee"
						? /data-member-slug="([^"]+)"/.exec(
								target?.segment || ""
						  )?.[1]
						: null) || null;

				// Replace the clicked wrapper with the new one
				let updated = replaceWrapperInstanceOnLine(
					before,
					instanceId,
					newHtml
				);

				// Remove any other wrappers of the same assignType on the same line
				updated = removeWrappersOfTypeOnLine(
					updated,
					assignType,
					instanceId
				);

				// Ensure trailing spacing
				updated = updated.replace(/\s+$/, " ");

				updateEditorLine(editor, lineNo, updated);

				// Emit cascade only when the assignment type is the primary "assignee"
				if (assignType === "assignee") {
					const targetsEls = getEventTargets(app, view);
					const detail = {
						filePath,
						parentLine0: lineNo,
						// Provide a true pre-mutation snapshot; override parent line with 'before'
						beforeLines: beforeDoc.map((s: string, idx: number) =>
							idx === lineNo ? before : s
						),
						newAssigneeSlug: isEveryone ? "everyone" : memberSlug,
						oldAssigneeSlug: oldSlug, // explicitly pass the previous assignee
					};
					for (const t of targetsEls) {
						try {
							(t as any).dispatchEvent?.(
								new CustomEvent("agile:assignee-changed", {
									detail,
								})
							);
						} catch {}
					}
				}
			});
		});
	};

	const stateOpposite = currentState === "active" ? "inactive" : "active";

	if (isAssignee) {
		// Everyone option (only if file belongs to a team)
		if (team) {
			if (currentSlug === "everyone") {
				// Only offer opposite state
				addAssignItem(
					`Everyone (${toTitleCase(stateOpposite)})`,
					"Everyone",
					"everyone",
					"special",
					stateOpposite
				);
			} else {
				addAssignItem(
					`Everyone (Active)`,
					"Everyone",
					"everyone",
					"special",
					"active"
				);
				addAssignItem(
					`Everyone (Inactive)`,
					"Everyone",
					"everyone",
					"special",
					"inactive"
				);
			}
		}

		// Team members only (exclude delegates)
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
	}

	if (isDelegate) {
		// Delegates: internal teams, internal team members, external delegates
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
}

/**
 * Wire DOM handlers to manage clicks on members.assignee wrappers (assignee / delegate marks).
 * This should be registered similarly to your templating DOM handlers.
 */
export function wireTaskAssignmentDomHandlers(
	app: App,
	view: MarkdownView,
	plugin: Plugin,
	ports: { orgStructure: OrgStructurePort }
) {
	// Resolve content root
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

		// We handle this click; prevent downstream handlers
		evt.preventDefault();
		evt.stopPropagation();
		// @ts-ignore
		(evt as any).stopImmediatePropagation?.();

		try {
			const templateKey = el.getAttribute("data-template-key") ?? "";
			if (templateKey !== "members.assignee") return;

			// Extract current props from the wrapper
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
			const editor: any = (viewNow as any).editor;
			const filePath = viewNow.file?.path ?? "";
			if (!editor || !filePath) return;

			// Build and show menu at click position
			const menu = new Menu();
			buildMenuForAssignment(menu, {
				assignType,
				currentSlug,
				currentState,
				instanceId,
				filePath,
				app,
				plugin,
				ports,
			});
			// Show the menu
			menu.showAtPosition({ x: evt.clientX, y: evt.clientY });
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
