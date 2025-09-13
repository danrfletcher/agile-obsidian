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
import { removeWrappersOfTypeOnLine } from "./assignment-inline-utils";

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
	const editor: any = (view as any).editor;
	if (!editor) return false;

	try {
		const ctx = await getCursorContext(app, view, editor);
		const text = ctx.lineText ?? "";
		const trimmed = text.trim();

		if (trimmed.length === 0) return true;
		const isTask = /^\s*[-*+]\s+\[(?: |x|X)\]\s+/.test(text);
		return isTask;
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
		memberLabel: string;
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

function makeCommandName(
	state: "active" | "inactive",
	memberName: string,
	memberLabel: string
): string {
	return `Assign as ${state} to ${memberName} (${memberLabel})`;
}

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
			editor.setCursor?.({ line: lineNo, ch: updated.length });
		}
	} catch {}
}

// Resolve the preferred DOM target for events (content root) plus global fallback
function getEventTargets(app: App): EventTarget[] {
	const targets: EventTarget[] = [];
	const globalDoc = (window as any)?.document ?? document;
	if (globalDoc) targets.push(globalDoc);

	const view = getActiveMarkdownView(app);
	const cmHolder = view as unknown as {
		editor?: { cm?: { contentDOM?: HTMLElement } };
	};
	const cmContent =
		cmHolder?.editor?.cm?.contentDOM ??
		view?.containerEl?.querySelector?.(".cm-content") ??
		null;
	if (cmContent) targets.unshift(cmContent);
	return targets;
}

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
		} catch {}
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
								const beforeLines = (
									editor.getValue?.() ?? ""
								).split(/\r?\n/);
								const parentLine0 =
									editor.getCursor?.().line ?? 0;

								const assignType: "assignee" | "delegate" =
									t.memberType === "teamMember" ||
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

								// Emit cascade event only for assignee (not delegates)
								if (assignType === "assignee") {
									const targets = getEventTargets(app);
									const detail = {
										filePath: pathNow,
										parentLine0,
										beforeLines,
										newAssigneeSlug:
											(t as any).memberType === "special"
												? "everyone"
												: t.memberSlug,
									};
									console.log(
										"[assign] command invoked; dispatch cascade",
										{
											id,
											target: t.memberSlug,
											state,
											detail,
											targets: targets.length,
										}
									);
									for (const target of targets) {
										(target as any).dispatchEvent?.(
											new CustomEvent(
												"agile:assignee-changed",
												{ detail }
											)
										);
									}
								}
							} catch (err) {
								console.error("[assign] unexpected error", err);
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
							const beforeLines = (
								editor.getValue?.() ?? ""
							).split(/\r?\n/);
							const parentLine0 = editor.getCursor?.().line ?? 0;

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

							const targets = getEventTargets(app);
							const detail = {
								filePath: pathNow,
								parentLine0,
								beforeLines,
								newAssigneeSlug: "everyone",
							};
							console.log(
								"[assign] command invoked; dispatch cascade",
								{
									id: everyoneId,
									target: "everyone",
									state: "active",
									detail,
									targets: targets.length,
								}
							);
							for (const target of targets) {
								try {
									(target as any).dispatchEvent?.(
										new CustomEvent(
											"agile:assignee-changed",
											{ detail }
										)
									);
								} catch {}
							}
						} catch (err) {
							console.error("[assign] unexpected error", err);
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
