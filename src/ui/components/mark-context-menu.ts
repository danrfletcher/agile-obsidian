/**
 * Context menu for assignment/delegation marks.
 *
 * In-app context:
 * - Handles single-clicks on inline <mark> blocks to show a menu with actions for assignees and delegates.
 *
 * Plugin value:
 * - Provides a consistent, cursor-preserving UI for editing task metadata beyond plain Markdown.
 */

import { App, MarkdownView, Menu } from "obsidian";
import { renderDelegateMark } from "src/domain/tasks/assignment/mark-templates";

type Ctx = {
	resolveTeamForPath: (filePath: string, teams: any[]) => any;
	isUncheckedTaskLine: (line: string) => boolean;
	normalizeTaskLine: (line: string, opts?: any) => string;
	findTargetLineFromClick: (
		editor: any,
		evt: MouseEvent,
		alias: string
	) => number;
	getExplicitAssigneeAliasFromText: (line: string) => string | null;
	applyAssigneeChangeWithCascade: (
		filePath: string,
		editor: any,
		lineNo: number,
		oldAlias: string | null,
		newAlias: string | null,
		variant: "active" | "inactive",
		team: any
	) => Promise<void>;
};

/**
 * Register global click handlers to show the mark context menu. Returns an unregister function.
 *
 * In-app use:
 * - Wired up by the plugin on load; cleans up automatically on unload via the returned disposer.
 *
 * Plugin value:
 * - Consolidates DOM event plumbing for mark interactions outside of main plugin class.
 *
 * @param app Obsidian app instance.
 * @param getSettings Lazy accessor for settings (to avoid stale references).
 * @param ctx Helper functions and cascade operation bound with dependencies.
 * @returns Disposer to remove the event listeners.
 */
export function registerMarkClickHandlers(
	app: App,
	getSettings: () => any,
	ctx: Ctx
): () => void {
	// Title Case helper for display names
	const toTitleCase = (s: string) =>
		s.replace(
			/\S+/g,
			(w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
		);

	// After we mutate the line, keep exactly one space after </mark> and put cursor there
	const setCursorAfterLastMark = (editor: any, lineNo: number) => {
		let line = editor.getLine(lineNo);

		// Ensure exactly one space after a trailing </mark>
		if (/<\/mark>\s*$/i.test(line)) {
			line = line.replace(/\s*$/, " ");
			editor.replaceRange(
				line,
				{ line: lineNo, ch: 0 },
				{ line: lineNo, ch: editor.getLine(lineNo).length }
			);
		}

		const lastClose = line.lastIndexOf("</mark>");
		if (lastClose >= 0) {
			// Cursor after </mark> and after a single trailing space
			const ch = lastClose + "</mark>".length + 1; // the one trailing space
			editor.setCursor({ line: lineNo, ch });
		} else {
			// Fallback: end of line
			editor.setCursor({ line: lineNo, ch: line.length });
		}
	};

	// Allow reassignment on any task status except done "x" and cancelled "-"
	const isReassignableTaskLine = (line: string): boolean => {
		const m = /^\s*[-*]\s*\[\s*([^\]]?)\s*\]\s+/i.exec(line);
		if (!m) return false;
		const status = (m[1] ?? "").trim().toLowerCase();
		return status !== "x" && status !== "-";
	};

	const mousedown = async (evt: MouseEvent) => {
		const target = evt.target as HTMLElement | null;
		if (!target) return;
		const markEl = target.closest("mark") as HTMLElement | null;
		if (!markEl) return;

		// Only handle our assignment/delegation marks (active|inactive-<alias>)
		const cls = markEl.getAttribute("class") || "";
		if (!/\b(?:active|inactive)-[a-z0-9-]+\b/i.test(cls)) return;

		// Single-click
		if (evt.detail < 2) {
			evt.preventDefault();
			evt.stopPropagation();
			// @ts-ignore
			(evt as any).stopImmediatePropagation?.();

			const view = app.workspace.getActiveViewOfType(MarkdownView);
			if (!view) return;
			const editor = (view as any).editor;
			const filePath = (view as any)?.file?.path ?? null;
			if (!filePath) return;

			const variant = (/\bactive-/i.test(cls) ? "active" : "inactive") as
				| "active"
				| "inactive";
			const alias = (
				/\b(?:active|inactive)-([a-z0-9-]+)\b/i.exec(cls)?.[1] || ""
			).toLowerCase();

			const team = ctx.resolveTeamForPath(
				filePath,
				(getSettings() as any)?.teams ?? []
			);
			if (!team) return;

			// Determine the actual line
			const savedCursor = editor.getCursor();
			const lineNo = ctx.findTargetLineFromClick(editor, evt, alias);
			const currentLine = editor.getLine(lineNo);
			if (!isReassignableTaskLine(currentLine)) return;

			// Determine assignee vs delegate mark
			const text = (markEl.textContent || "").trim();
			const isAssignee = alias === "team" || text.includes("👋");
			const isDelegate = !isAssignee;

			const menu = new Menu();

			if (isAssignee) {
				// Remove Assignee
				menu.addItem((i) => {
					i.setTitle("Remove Assignee");
					i.onClick(() => {
						const before = editor.getLine(lineNo);
						if (!isReassignableTaskLine(before)) {
							setCursorAfterLastMark(editor, lineNo);
							return;
						}
						const oldAlias =
							ctx.getExplicitAssigneeAliasFromText(before);
						ctx.applyAssigneeChangeWithCascade(
							filePath,
							editor,
							lineNo,
							oldAlias,
							null,
							"active",
							team
						).finally(() => setCursorAfterLastMark(editor, lineNo));
					});
				});

				// Everyone options
				const addEveryone = (v: "active" | "inactive") => {
					menu.addItem((i) => {
						i.setTitle(`Everyone (${v})`);
						i.onClick(() => {
							const before = editor.getLine(lineNo);
							if (!isReassignableTaskLine(before)) {
								setCursorAfterLastMark(editor, lineNo);
								return;
							}
							const oldAlias =
								ctx.getExplicitAssigneeAliasFromText(before);
							ctx.applyAssigneeChangeWithCascade(
								filePath,
								editor,
								lineNo,
								oldAlias,
								"team",
								v,
								team
							).finally(() =>
								setCursorAfterLastMark(editor, lineNo)
							);
						});
					});
				};

				if (alias === "team") {
					addEveryone(variant === "active" ? "inactive" : "active");
				} else {
					addEveryone("active");
					addEveryone("inactive");
				}

				// Team members (non -ext/-team/-int)
				const members: any[] = (team.members ?? []).filter((m: any) => {
					const a = (m.alias || "").toLowerCase();
					return (
						a &&
						!a.endsWith("-ext") &&
						!a.endsWith("-team") &&
						!a.endsWith("-int")
					);
				});

				const addMember = (mem: any, v: "active" | "inactive") => {
					const displayName = toTitleCase(
						mem.name || mem.alias || ""
					);
					menu.addItem((i) => {
						i.setTitle(`${displayName} (${v})`);
						i.onClick(() => {
							const before = editor.getLine(lineNo);
							if (!isReassignableTaskLine(before)) {
								setCursorAfterLastMark(editor, lineNo);
								return;
							}
							const oldAlias =
								ctx.getExplicitAssigneeAliasFromText(before);
							const memAlias = (mem.alias || "").toLowerCase();
							ctx.applyAssigneeChangeWithCascade(
								filePath,
								editor,
								lineNo,
								oldAlias,
								memAlias,
								v,
								team
							).finally(() =>
								setCursorAfterLastMark(editor, lineNo)
							);
						});
					});
				};

				for (const mem of members) {
					if ((mem.alias || "").toLowerCase() === alias) {
						addMember(
							mem,
							variant === "active" ? "inactive" : "active"
						);
					} else {
						addMember(mem, "active");
						addMember(mem, "inactive");
					}
				}
			} else if (isDelegate) {
				// Disallow if assigned to Everyone
				if (/\bclass="(?:active|inactive)-team"\b/i.test(currentLine)) {
					return;
				}

				// Remove Delegation
				menu.addItem((i) => {
					i.setTitle("Remove Delegation");
					i.onClick(() => {
						const before = editor.getLine(lineNo);
						if (!isReassignableTaskLine(before)) {
							setCursorAfterLastMark(editor, lineNo);
							return;
						}
						let updated = ctx.normalizeTaskLine(before, {
							newDelegateMark: null,
						});
						if (/<\/mark>\s*$/.test(updated))
							updated = updated.replace(/\s*$/, " ");
						editor.replaceRange(
							updated,
							{ line: lineNo, ch: 0 },
							{ line: lineNo, ch: before.length }
						);
						setCursorAfterLastMark(editor, lineNo);
					});
				});

				const dVariant = "active" as const; // Delegates can only be active

				// Internal Teams (-team but not bare 'team')
				const internalTeams: any[] = (team.members ?? []).filter(
					(m: any) => {
						const a = (m.alias || "").toLowerCase();
						return a.endsWith("-team") && a !== "team";
					}
				);
				for (const t of internalTeams) {
					const displayName = toTitleCase(t.name || t.alias || "");
					menu.addItem((i) => {
						i.setTitle(displayName);
						i.onClick(() => {
							const before = editor.getLine(lineNo);
							if (!isReassignableTaskLine(before)) {
								setCursorAfterLastMark(editor, lineNo);
								return;
							}
							let updated = ctx.normalizeTaskLine(before, {
								newDelegateMark: renderDelegateMark(
									t.alias,
									displayName,
									dVariant,
									"team"
								),
							});
							if (/<\/mark>\s*$/.test(updated))
								updated = updated.replace(/\s*$/, " ");
							editor.replaceRange(
								updated,
								{ line: lineNo, ch: 0 },
								{ line: lineNo, ch: before.length }
							);
							setCursorAfterLastMark(editor, lineNo);
						});
					});
				}

				// Internal Members (-int)
				const internalMembers: any[] = (team.members ?? []).filter(
					(m: any) => (m.alias || "").toLowerCase().endsWith("-int")
				);
				for (const im of internalMembers) {
					const displayName = toTitleCase(im.name || im.alias || "");
					menu.addItem((i) => {
						i.setTitle(displayName);
						i.onClick(() => {
							const before = editor.getLine(lineNo);
							if (!isReassignableTaskLine(before)) {
								setCursorAfterLastMark(editor, lineNo);
								return;
							}
							let updated = ctx.normalizeTaskLine(before, {
								newDelegateMark: renderDelegateMark(
									im.alias,
									displayName,
									dVariant,
									"internal"
								),
							});
							if (/<\/mark>\s*$/.test(updated))
								updated = updated.replace(/\s*$/, " ");
							editor.replaceRange(
								updated,
								{ line: lineNo, ch: 0 },
								{ line: lineNo, ch: before.length }
							);
							setCursorAfterLastMark(editor, lineNo);
						});
					});
				}

				// External Delegates (-ext)
				const externals: any[] = (team.members ?? []).filter((m: any) =>
					(m.alias || "").toLowerCase().endsWith("-ext")
				);
				for (const ex of externals) {
					const displayName = toTitleCase(ex.name || ex.alias || "");
					menu.addItem((i) => {
						i.setTitle(displayName);
						i.onClick(() => {
							const before = editor.getLine(lineNo);
							if (!isReassignableTaskLine(before)) {
								setCursorAfterLastMark(editor, lineNo);
								return;
							}
							let updated = ctx.normalizeTaskLine(before, {
								newDelegateMark: renderDelegateMark(
									ex.alias,
									displayName,
									dVariant,
									"external"
								),
							});
							if (/<\/mark>\s*$/.test(updated))
								updated = updated.replace(/\s*$/, " ");
							editor.replaceRange(
								updated,
								{ line: lineNo, ch: 0 },
								{ line: lineNo, ch: before.length }
							);
							setCursorAfterLastMark(editor, lineNo);
						});
					});
				}
			}

			if ((menu as any).items?.length > 0) {
				menu.showAtPosition({ x: evt.clientX, y: evt.clientY });
			}
		}
	};

	const click = (evt: MouseEvent) => {
		const target = evt.target as HTMLElement | null;
		if (!target) return;
		const markEl = target.closest("mark") as HTMLElement | null;
		if (!markEl) return;

		// Only handle our assignment/delegation marks
		const cls = markEl.getAttribute("class") || "";
		if (!/\b(?:active|inactive)-[a-z0-9-]+\b/i.test(cls)) return;

		if (evt.detail < 2) {
			evt.preventDefault();
			evt.stopPropagation();
			// @ts-ignore
			(evt as any).stopImmediatePropagation?.();
		}
	};

	document.addEventListener("mousedown", mousedown as EventListener, {
		capture: true,
	});
	document.addEventListener("click", click as EventListener, {
		capture: true,
	});

	return () => {
		document.removeEventListener(
			"mousedown",
			mousedown as EventListener,
			{ capture: true } as any
		);
		document.removeEventListener(
			"click",
			click as EventListener,
			{ capture: true } as any
		);
	};
}
