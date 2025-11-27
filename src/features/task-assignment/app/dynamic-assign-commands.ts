import type { App, Editor, Plugin } from "obsidian";
import { MarkdownView, Notice } from "obsidian";
import { insertTemplateAtCursor } from "@features/templating-engine";
import type {
	OrgStructurePort,
	MemberInfo,
	MembersBuckets,
} from "@features/org-structure";
import { classifyMember } from "@features/org-structure";
import { getCursorContext, isTaskLine } from "@platform/obsidian";
import { removeWrappersOfTypeOnLine } from "./assignment-inline-utils";
import { AddMemberModal, type AddMemberKind } from "../ui/add-member-modal";

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

function getActiveMarkdownView(app: App): MarkdownView | null {
	return app.workspace.getActiveViewOfType(MarkdownView) ?? null;
}

async function isAssigneeAllowedHere(app: App): Promise<boolean> {
	const view = getActiveMarkdownView(app);
	if (!view) return false;
	const editor = view.editor;
	if (!editor) return false;

	try {
		const ctx = await getCursorContext(app, view, editor);
		const text = ctx.lineText ?? "";
		const trimmed = text.trim();

		// allow on empty lines (we will coerce to task line as needed downstream)
		if (trimmed.length === 0) return true;

		// allow on any task status via canonical platform util
		return isTaskLine(text);
	} catch {
		return false;
	}
}

function buildAssignmentTargets(
	members: MemberInfo[],
	_buckets: MembersBuckets
) {
	const out: Array<{
		memberName: string;
		memberSlug: string;
		memberLabel: string; // e.g. "External delegate"
		memberType:
			| "teamMember"
			| "delegateTeam"
			| "delegateTeamMember"
			| "delegateExternal";
	}> = [];

	for (const m of members) {
		const c = classifyMember(m);
		out.push({
			memberName: m.name?.trim() ?? m.alias?.trim() ?? "",
			memberSlug: (m.alias ?? "").trim(),
			memberLabel: c.label,
			memberType: mapMemberKindToAssigneeType(c.kind),
		});
	}

	return out;
}

const ASSIGNEE_TEMPLATE_ID = "members.assignee";

function safeIdPart(s: string): string {
	return s.toLowerCase().replace(/[^a-z0-9._-]/g, "_");
}

// Naming
function makeAssigneeCommandName(
	state: "active" | "inactive",
	memberName: string
): string {
	const stateLabel = state === "active" ? "active" : "inactive";
	return `Set ${stateLabel} assignee as ${memberName}`;
}
function makeDelegateCommandName(
	state: "active" | "inactive",
	memberName: string,
	memberLabel: string
): string {
	const stateLabel = state === "active" ? "active" : "inactive";
	return `Set ${stateLabel} delegate as ${memberName} (${memberLabel})`;
}
function makeAssigneeNewMemberCommandName(
	state: "active" | "inactive"
): string {
	const stateLabel = state === "active" ? "active" : "inactive";
	return `Set ${stateLabel} assignee as new member`;
}
function makeDelegateNewMemberCommandName(
	state: "active" | "inactive"
): string {
	const stateLabel = state === "active" ? "active" : "inactive";
	return `Set ${stateLabel} delegate as new member`;
}

function clearExistingOfTypeOnCurrentLine(
	editor: Editor,
	assignType: "assignee" | "delegate"
) {
	try {
		const cur = editor.getCursor();
		const lineNo = cur?.line ?? 0;
		const lineText = editor.getLine(lineNo) ?? "";
		const updated = removeWrappersOfTypeOnLine(lineText, assignType, null);
		if (updated !== lineText) {
			editor.replaceRange(
				updated,
				{ line: lineNo, ch: 0 },
				{ line: lineNo, ch: lineText.length }
			);
			editor.setCursor?.({ line: lineNo, ch: updated.length });
		}
	} catch {
		// ignore
	}
}

// Resolve the preferred DOM target for events (content root) plus global fallback
function getEventTargets(app: App): EventTarget[] {
	const targets: EventTarget[] = [];

	const maybeWindow =
		typeof globalThis !== "undefined" && "window" in globalThis
			? (globalThis as typeof globalThis & {
					window?: Window & typeof globalThis;
			  }).window
			: undefined;
	if (maybeWindow) {
		targets.push(maybeWindow);
	}

	const maybeDocument =
		typeof globalThis !== "undefined" && "document" in globalThis
			? (globalThis as typeof globalThis & {
					document?: Document;
			  }).document
			: undefined;
	if (maybeDocument) {
		targets.push(maybeDocument);
	}

	const view = getActiveMarkdownView(app);
	const cmHolder =
		view as
			| (MarkdownView & {
					editor?: { cm?: { contentDOM?: HTMLElement } };
			  })
			| null;
	const cmContent =
		cmHolder?.editor?.cm?.contentDOM ??
		view?.containerEl?.querySelector?.(".cm-content") ??
		null;
	if (cmContent) targets.unshift(cmContent);

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

type AssigneeChangedDetail = {
	filePath: string;
	parentLine0: number;
	beforeLines: string[];
	newAssigneeSlug: string | null;
	oldAssigneeSlug: string | null;
};

type AppWithCommands = App & {
	commands?: {
		removeCommand?: (id: string) => void;
	};
};

export async function registerTaskAssignmentDynamicCommands(
	app: App,
	plugin: Plugin,
	manifestId: string,
	ports: { orgStructure: OrgStructurePort }
): Promise<void> {
	const currentIds = new Set<string>();
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	const removeCommand = (id: string): void => {
		try {
			const appWithCommands = app as AppWithCommands;
			const commands = appWithCommands.commands;
			if (!commands?.removeCommand) return;
			commands.removeCommand(id);
		} catch {
			// ignore
		}
	};

	const clearAll = () => {
		for (const id of currentIds) removeCommand(id);
		currentIds.clear();
	};

	plugin.register(() => {
		clearAll();
	});

	const recompute = async () => {
		clearAll();

		const view = getActiveMarkdownView(app);
		const filePath = view?.file?.path ?? "";
		if (!filePath) return;

		const { members, buckets, team } =
			ports.orgStructure.getTeamMembersForFile(filePath);
		const targets = buildAssignmentTargets(members, buckets);

		// Existing member commands (assignee + delegates)
		for (const t of targets) {
			for (const state of ["active", "inactive"] as const) {
				const isAssignee = t.memberType === "teamMember";
				const isDelegate =
					t.memberType === "delegateTeam" ||
					t.memberType === "delegateTeamMember" ||
					t.memberType === "delegateExternal";
				if (!isAssignee && !isDelegate) continue;

				const role = isAssignee ? "assignee" : "delegate";
				const id = `${manifestId}:${role}:${safeIdPart(
					t.memberSlug
				)}:${state}`;
				const name = isAssignee
					? makeAssigneeCommandName(state, t.memberName)
					: makeDelegateCommandName(
							state,
							t.memberName,
							t.memberLabel
					  );

				plugin.addCommand({
					id,
					name,
					checkCallback: (checking: boolean) => {
						const v = getActiveMarkdownView(app);
						if (!v?.file?.path) return false;

						const cur = ports.orgStructure.getTeamMembersForFile(
							v.file.path
						);
						const exists = (cur.members ?? []).some(
							(m) =>
								(m.alias ?? "").trim().toLowerCase() ===
								t.memberSlug.toLowerCase()
						);
						if (!exists) return false;

						const whenAllowed = async () => {
							const ok = await isAssigneeAllowedHere(app);
							return ok;
						};

						if (checking) {
							const vnow = getActiveMarkdownView(app);
							const editor = vnow?.editor;
							if (!vnow || !editor) return false;

							try {
								const lineNo =
									editor.getCursor().line ?? 0;
								const text = editor.getLine(lineNo) ?? "";
								if (text.trim().length === 0) return true;
								// Allow any status task via shared util
								return isTaskLine(text);
							} catch {
								return false;
							}
						}

						// Execute
						const vnow = getActiveMarkdownView(app);
						if (!vnow) {
							new Notice("No active Markdown view.");
							return true;
						}
						const editor = vnow.editor;
						if (!editor) {
							new Notice("Editor not available.");
							return true;
						}

						const pathNow = vnow.file?.path ?? "";
						if (!pathNow) {
							new Notice("No active file.");
							return true;
						}

						void (async () => {
							const ok = await whenAllowed();
							if (!ok) {
								new Notice(
									"Assignee/delegate can only be inserted on task or empty lines."
								);
								return;
							}

							try {
								const beforeLines = (
									editor.getValue?.() ?? ""
								).split(/\r?\n/);
								const parentLine0 =
									editor.getCursor?.().line ?? 0;

								const assignType: "assignee" | "delegate" =
									isAssignee ? "assignee" : "delegate";
								clearExistingOfTypeOnCurrentLine(
									editor,
									assignType
								);

								insertTemplateAtCursor(
									ASSIGNEE_TEMPLATE_ID,
									editor,
									pathNow,
									{
										memberName: t.memberName,
										memberSlug: t.memberSlug,
										memberType: t.memberType,
										assignmentState: state,
									}
								);

								if (assignType === "assignee") {
									const targetsForEvent =
										getEventTargets(app);
									const detail: AssigneeChangedDetail = {
										filePath: pathNow,
										parentLine0,
										beforeLines,
										newAssigneeSlug: t.memberSlug,
										oldAssigneeSlug: null,
									};
									for (const target of targetsForEvent) {
										target.dispatchEvent(
											new CustomEvent<AssigneeChangedDetail>(
												"agile:assignee-changed",
												{ detail }
											)
										);
									}
								}
							} catch (err) {
								const error =
									err instanceof Error
										? err
										: new Error(String(err));
								console.error(
									"[assign] unexpected error",
									error
								);
								new Notice(
									`Insert failed: ${error.message}`
								);
							}
						})();

						return true;
					},
				});

				currentIds.add(id);
			}
		}

		// Special "Everyone" assignee command (team files)
		if (team) {
			const id = `${manifestId}:assignee:everyone:active`;
			const name = "Set active assignee as everyone";

			plugin.addCommand({
				id,
				name,
				checkCallback: (checking: boolean) => {
					const v = getActiveMarkdownView(app);
					if (!v?.file?.path) return false;

					const cur = ports.orgStructure.getTeamMembersForFile(
						v.file.path
					);
					if (!cur.team) return false;

					if (checking) {
						try {
							const editor = v.editor;
							const lineNo =
								editor.getCursor().line ?? 0;
							const text = editor.getLine(lineNo) ?? "";
							if (text.trim().length === 0) return true;
							return isTaskLine(text);
						} catch {
							return false;
						}
					}

					const editor = v.editor;
					if (!editor) {
						new Notice("Editor not available.");
						return true;
					}
					const pathNow = v.file?.path ?? "";
					if (!pathNow) {
						new Notice("No active file.");
						return true;
					}

					void (async () => {
						const ok = await isAssigneeAllowedHere(app);
						if (!ok) {
							new Notice(
								"Assignee can only be inserted on task or empty lines."
							);
							return;
						}
						try {
							const beforeLines = (
								editor.getValue?.() ?? ""
							).split(/\r?\n/);
							const parentLine0 =
								editor.getCursor?.().line ?? 0;

							clearExistingOfTypeOnCurrentLine(
								editor,
								"assignee"
							);

							insertTemplateAtCursor(
								ASSIGNEE_TEMPLATE_ID,
								editor,
								pathNow,
								{
									memberName: "Everyone",
									memberSlug: "everyone",
									memberType: "special",
									assignmentState: "active",
								}
							);

							const targetsForEvent = getEventTargets(app);
							const detail: AssigneeChangedDetail = {
								filePath: pathNow,
								parentLine0,
								beforeLines,
								newAssigneeSlug: "everyone",
								oldAssigneeSlug: null,
							};
							for (const target of targetsForEvent) {
								try {
									target.dispatchEvent(
										new CustomEvent<AssigneeChangedDetail>(
											"agile:assignee-changed",
											{ detail }
										)
									);
								} catch {
									// ignore
								}
							}
						} catch (err) {
							const error =
								err instanceof Error
									? err
									: new Error(String(err));
							console.error(
								"[assign] unexpected error",
								error
							);
							new Notice(
								`Insert failed: ${error.message}`
							);
						}
					})();

					return true;
				},
			});

			currentIds.add(id);
		}

		// New member commands (assignee + delegate)
		const registerNewMemberCommand = (
			role: "assignee" | "delegate",
			state: "active" | "inactive"
		) => {
			const id = `${manifestId}:${role}:new-member:${state}`;
			const name =
				role === "assignee"
					? makeAssigneeNewMemberCommandName(state)
					: makeDelegateNewMemberCommandName(state);

			plugin.addCommand({
				id,
				name,
				checkCallback: (checking: boolean) => {
					const v = getActiveMarkdownView(app);
					if (!v?.file?.path) return false;

					if (checking) {
						try {
							const editor = v.editor;
							const lineNo =
								editor.getCursor().line ?? 0;
							const text = editor.getLine(lineNo) ?? "";
							if (text.trim().length === 0) return true;
							return isTaskLine(text);
						} catch {
							return false;
						}
					}

					const editor = v.editor;
					if (!editor) {
						new Notice("Editor not available.");
						return true;
					}
					const pathNow = v.file?.path ?? "";
					if (!pathNow) {
						new Notice("No active file.");
						return true;
					}

					void (async () => {
						const ok = await isAssigneeAllowedHere(app);
						if (!ok) {
							new Notice(
								"Assignee/delegate can only be inserted on task or empty lines."
							);
							return;
						}

						try {
							// Build modal sources from current context
							const ctx =
								ports.orgStructure.getTeamMembersForFile(
									pathNow
								);
							const teamName = ctx.team?.name ?? "Team";
							const existingMembers = (ctx.members ??
								[]);
							// We don't have a global teams list here; restrict options accordingly
							const allTeams: string[] = [];
							const internalTeamCodes = new Map<string, string>();

							const submitButtonText =
								role === "assignee"
									? "Assign to new member"
									: "Delegate to new member";

							const allowedTypes =
								role === "assignee"
									? (["member"] as const) // assignee must be a team member
									: (["external", "existing"] as const); // delegate: external or existing (to support internal-team-member via role)

							new AddMemberModal(
								app,
								teamName,
								allTeams,
								existingMembers,
								internalTeamCodes,
								async (
									memberName,
									memberAlias,
									selectedKind
								) => {
									const assignType = role;
									clearExistingOfTypeOnCurrentLine(
										editor,
										assignType
									);

									const memberType =
										role === "assignee"
											? "teamMember"
											: kindToMemberType(selectedKind);

									insertTemplateAtCursor(
										ASSIGNEE_TEMPLATE_ID,
										editor,
										pathNow,
										{
											memberName,
											memberSlug: memberAlias,
											memberType,
											assignmentState: state,
										}
									);

									if (assignType === "assignee") {
										const beforeLines = (
											editor.getValue?.() ?? ""
										).split(/\r?\n/);
										const parentLine0 =
											editor.getCursor?.().line ?? 0;
										const targetsForEvent =
											getEventTargets(app);
										const detail: AssigneeChangedDetail = {
											filePath: pathNow,
											parentLine0,
											beforeLines,
											newAssigneeSlug: memberAlias,
											oldAssigneeSlug: null,
										};
										for (const target of targetsForEvent) {
											target.dispatchEvent(
												new CustomEvent<AssigneeChangedDetail>(
													"agile:assignee-changed",
													{ detail }
												)
											);
										}
									}
								},
								{
									submitButtonText,
									allowedTypes: [...allowedTypes],
									titleText:
										role === "assignee"
											? "Assign to new member"
											: "Delegate to new member",
								}
							).open();
						} catch (err) {
							const error =
								err instanceof Error
									? err
									: new Error(String(err));
							console.error(
								"[assign-new] error",
								error
							);
							new Notice(
								`New member insert failed: ${error.message}`
							);
						}
					})();

					return true;
				},
			});

			currentIds.add(id);
		};

		registerNewMemberCommand("assignee", "active");
		registerNewMemberCommand("assignee", "inactive");
		registerNewMemberCommand("delegate", "active");
		registerNewMemberCommand("delegate", "inactive");
	};

	const scheduleRecompute = () => {
		if (debounceTimer != null) {
			clearTimeout(debounceTimer);
			debounceTimer = null;
		}
		debounceTimer = setTimeout(() => {
			debounceTimer = null;
			void recompute();
		}, 350);
	};

	// Initial build
	await recompute();

	// Update when file/view changes
	plugin.registerEvent(
		app.workspace.on("active-leaf-change", () => scheduleRecompute())
	);
	plugin.registerEvent(
		app.workspace.on("file-open", () => scheduleRecompute())
	);

	// Update on edits (could change members detection indirectly)
	plugin.registerEvent(
		app.workspace.on("editor-change", () => scheduleRecompute())
	);

	// Update on vault changes that impact org detection
	plugin.registerEvent(app.vault.on("create", () => scheduleRecompute()));
	plugin.registerEvent(app.vault.on("modify", () => scheduleRecompute()));
	plugin.registerEvent(app.vault.on("delete", () => scheduleRecompute()));
	plugin.registerEvent(app.vault.on("rename", () => scheduleRecompute()));
}