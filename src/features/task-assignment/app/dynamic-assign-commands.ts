import type { App, Plugin } from "obsidian";
import { MarkdownView, Notice } from "obsidian";
import { insertTemplateAtCursor } from "@features/templating";
import type {
	OrgStructurePort,
	MemberInfo,
	MembersBuckets,
} from "@features/org-structure";
import { classifyMember } from "@features/org-structure";
import { getCursorContext } from "@platform/obsidian";
import {
	removeWrappersOfTypeOnLine,
} from "./assignment-inline-utils";

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

/**
 * Get active MarkdownView safely.
 */
function getActiveMarkdownView(app: App): MarkdownView | null {
	return app.workspace.getActiveViewOfType(MarkdownView) ?? null;
}

/**
 * Determine whether the current line is allowed for the assignee template:
 * - Task line is allowed
 * - Empty line is allowed (we will convert to a task line at insert time)
 */
async function isAssigneeAllowedHere(app: App): Promise<boolean> {
	const view = getActiveMarkdownView(app);
	if (!view) return false;
	const editor: any = (view as any).editor;
	if (!editor) return false;

	try {
		const ctx = await getCursorContext(app, view, editor);
		const text = ctx.lineText ?? "";
		const trimmed = text.trim();

		if (trimmed.length === 0) return true; // empty: okay (we'll coerce to task)
		// Task regex: starts with optional spaces, then -, *, or + followed by [ ] or [x] and a space
		const isTask = /^\s*[-*+]\s+\[(?: |x|X)\]\s+/.test(text);
		return isTask;
	} catch {
		return false;
	}
}

/**
 * Build the set of "assignment target" members from org-structure for a file.
 */
function buildAssignmentTargets(
	members: MemberInfo[],
	_buckets: MembersBuckets
) {
	const out: Array<{
		memberName: string;
		memberSlug: string;
		memberLabel: string; // e.g., "Team Member", "Internal Team", ...
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

/**
 * Authoritative template id for assignee.
 */
const ASSIGNEE_TEMPLATE_ID = "members.assignee";

/**
 * Create a safe command id suffix from arbitrary text.
 */
function safeIdPart(s: string): string {
	return s.toLowerCase().replace(/[^a-z0-9._-]/g, "_");
}

/**
 * Human formatted command name per spec:
 * "Assign as <active/inactive> to <Member Name> (<Member type>)"
 */
function makeCommandName(
	state: "active" | "inactive",
	memberName: string,
	memberLabel: string
): string {
	return `Assign as ${state} to ${memberName} (${memberLabel})`;
}

/**
 * Remove all assignment wrappers of the specified assignType ("assignee" or "delegate")
 * from the current editor line before inserting a new one.
 */
function clearExistingOfTypeOnCurrentLine(
	editor: any,
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
			// place cursor at end
			editor.setCursor?.({ line: lineNo, ch: updated.length });
		}
	} catch {
		// ignore
	}
}

/**
 * Register dynamic assignment commands.
 * - Two commands per member associated with the open file (active/inactive).
 * - One "Everyone" command (active only) if file is associated with a team.
 * - Commands are dynamically rebuilt on file/view/content changes (debounced).
 * - Commands only enable/appear when the current line is a task or empty (assignee template rule).
 */
export async function registerTaskAssignmentDynamicCommands(
	app: App,
	plugin: Plugin,
	manifestId: string,
	ports: { orgStructure: OrgStructurePort }
): Promise<void> {
	const currentIds = new Set<string>();
	let debounceTimer: number | null = null;

	const removeCommand = (id: string) => {
		try {
			(app as any)?.commands?.removeCommand?.(id);
		} catch {
			// ignore
		}
	};

	const clearAll = () => {
		for (const id of currentIds) {
			removeCommand(id);
		}
		currentIds.clear();
	};

	// Ensure cleanup on unload
	plugin.register(() => {
		clearAll();
	});

	// Core recompute: rebuild the full set of commands for the current active file
	const recompute = async () => {
		clearAll();

		const view = getActiveMarkdownView(app);
		const filePath = view?.file?.path ?? "";
		if (!filePath) return;

		// Ask org-structure which team and members apply to this file
		const { members, buckets, team } =
			ports.orgStructure.getTeamMembersForFile(filePath);

		// Build assignment targets (sorted as provided by the service)
		const targets = buildAssignmentTargets(members, buckets);

		// Build and register commands: 2 per member (active, inactive)
		for (const t of targets) {
			for (const state of ["active", "inactive"] as const) {
				const id = `${manifestId}:assign:${safeIdPart(
					t.memberSlug
				)}:${state}`;
				const name = makeCommandName(
					state,
					t.memberName,
					t.memberLabel
				);

				plugin.addCommand({
					id,
					name,
					checkCallback: (checking: boolean) => {
						// Only enable when:
						// - The member is still applicable for the current file
						// - The current line is a task or empty
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

						// Enforce allowed-on (task-only) rule for assignee template
						// but allow empty line (we'll coerce it to a task line on insert).
						// If checking: return boolean. If invoking: perform insertion and return true.
						const whenAllowed = async () => {
							const ok = await isAssigneeAllowedHere(app);
							return ok;
						};

						if (checking) {
							// Synchronous fallback: we try best-effort sync check. If view/editor missing, hide.
							const vnow = getActiveMarkdownView(app);
							if (!vnow || !(vnow as any).editor) return false;

							try {
								const editor: any = (vnow as any).editor;
								const lineNo = editor.getCursor().line ?? 0;
								const text = editor.getLine(lineNo) ?? "";
								if (text.trim().length === 0) return true;
								const isTask =
									/^\s*[-*+]\s+\[(?: |x|X)\]\s+/.test(text);
								return isTask;
							} catch {
								return false;
							}
						}

						// Not checking: execute
						const vnow = getActiveMarkdownView(app);
						if (!vnow) {
							new Notice("No active Markdown view.");
							return true;
						}
						const editor: any = (vnow as any).editor;
						if (!editor) {
							new Notice("Editor not available.");
							return true;
						}

						// Use live filePath for insertion
						const pathNow = vnow.file?.path ?? "";
						if (!pathNow) {
							new Notice("No active file.");
							return true;
						}

						void (async () => {
							const ok = await whenAllowed();
							if (!ok) {
								new Notice(
									"Assignee can only be inserted on task or empty lines."
								);
								return;
							}

							try {
								// Enforce uniqueness: remove any existing of the same assignType on this line
								const assignType: "assignee" | "delegate" =
									t.memberType === "teamMember" ||
									// treat "special" (Everyone) as assignee
									(t as any).memberType === "special"
										? "assignee"
										: "delegate";
								clearExistingOfTypeOnCurrentLine(
									editor,
									assignType
								);

								insertTemplateAtCursor(
									ASSIGNEE_TEMPLATE_ID,
									editor as any,
									pathNow,
									{
										memberName: t.memberName,
										memberSlug: t.memberSlug,
										memberType: t.memberType,
										assignmentState: state,
									}
								);
							} catch (err) {
								new Notice(
									`Insert failed: ${String(
										(err as Error)?.message ?? err
									)}`
								);
							}
						})();

						return true;
					},
				});

				currentIds.add(id);
			}
		}

		// Special "Everyone" (active only) when file is associated with a team
		if (team) {
			const everyoneId = `${manifestId}:assign:everyone:active`;
			const everyoneName = `Assign as active to Everyone (Special)`;

			plugin.addCommand({
				id: everyoneId,
				name: everyoneName,
				checkCallback: (checking: boolean) => {
					const v = getActiveMarkdownView(app);
					if (!v?.file?.path) return false;

					const cur = ports.orgStructure.getTeamMembersForFile(
						v.file.path
					);
					if (!cur.team) return false;

					if (checking) {
						try {
							const editor: any = (v as any).editor;
							const lineNo = editor.getCursor().line ?? 0;
							const text = editor.getLine(lineNo) ?? "";
							if (text.trim().length === 0) return true;
							const isTask = /^\s*[-*+]\s+\[(?: |x|X)\]\s+/.test(
								text
							);
							return isTask;
						} catch {
							return false;
						}
					}

					const editor: any = (v as any).editor;
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
							// Enforce uniqueness: 'Everyone' is an assignee
							clearExistingOfTypeOnCurrentLine(
								editor,
								"assignee"
							);

							insertTemplateAtCursor(
								ASSIGNEE_TEMPLATE_ID,
								editor as any,
								pathNow,
								{
									memberName: "Everyone",
									memberSlug: "everyone",
									memberType: "special",
									assignmentState: "active",
								}
							);
						} catch (err) {
							new Notice(
								`Insert failed: ${String(
									(err as Error)?.message ?? err
								)}`
							);
						}
					})();

					return true;
				},
			});

			currentIds.add(everyoneId);
		}
	};

	const scheduleRecompute = () => {
		if (debounceTimer != null) {
			window.clearTimeout(debounceTimer);
			debounceTimer = null;
		}
		debounceTimer = window.setTimeout(() => {
			debounceTimer = null;
			void recompute();
		}, 350) as unknown as number;
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
