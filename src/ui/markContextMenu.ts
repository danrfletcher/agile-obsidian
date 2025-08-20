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
import { renderDelegateMark } from "../samples/markTemplates";

type Ctx = {
	resolveTeamForPath: (filePath: string, teams: any[]) => any;
	isUncheckedTaskLine: (line: string) => boolean;
	normalizeTaskLine: (line: string, opts?: any) => string;
	findTargetLineFromClick: (editor: any, evt: MouseEvent, alias: string) => number;
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
export function registerMarkClickHandlers(app: App, getSettings: () => any, ctx: Ctx): () => void {
	const mousedown = async (evt: MouseEvent) => {
		const target = evt.target as HTMLElement | null;
		if (!target) return;
		const markEl = target.closest("mark") as HTMLElement | null;
		if (!markEl) return;

		// Only handle our assignment/delegation marks (active|inactive-<alias>)
		const cls = markEl.getAttribute("class") || "";
		if (!/\b(?:active|inactive)-[a-z0-9-]+\b/i.test(cls)) return;

		// Single-click: prevent default selection/opening and show menu
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

			const variant = ((/\bactive-/i.test(cls) ? "active" : "inactive") as "active" | "inactive");
			const alias = (/\b(?:active|inactive)-([a-z0-9-]+)\b/i.exec(cls)?.[1] || "").toLowerCase();

			const team = ctx.resolveTeamForPath(filePath, (getSettings() as any)?.teams ?? []);
			if (!team) return;

			// Determine the actual line for the clicked mark and preserve the current cursor
			const savedCursor = editor.getCursor();
			const lineNo = ctx.findTargetLineFromClick(editor, evt, alias);
			const currentLine = editor.getLine(lineNo);
			if (!ctx.isUncheckedTaskLine(currentLine)) return;

			// Determine if this mark is an assignee or delegate based on content/alias
			const text = (markEl.textContent || "").trim();
			const isAssignee = alias === "team" || text.includes("👋");
			const isDelegate = !isAssignee;

			const menu = new Menu();

			if (isAssignee) {
				// Remove Assignee option
				menu.addItem((i) => {
					i.setTitle("Remove Assignee");
					i.onClick(() => {
						const before = editor.getLine(lineNo);
						const oldAlias = ctx.getExplicitAssigneeAliasFromText(before);
						ctx.applyAssigneeChangeWithCascade(filePath, editor, lineNo, oldAlias, null, "active", team)
							.finally(() => editor.setCursor(savedCursor));
					});
				});

				// Everyone options
				const addEveryone = (v: "active" | "inactive") => {
					menu.addItem((i) => {
						i.setTitle(`Everyone (${v})`);
						i.onClick(() => {
							const before = editor.getLine(lineNo);
							const oldAlias = ctx.getExplicitAssigneeAliasFromText(before);
							ctx.applyAssigneeChangeWithCascade(filePath, editor, lineNo, oldAlias, "team", v, team)
								.finally(() => editor.setCursor(savedCursor));
						});
					});
				};
				if (alias === "team") {
					addEveryone(variant === "active" ? "inactive" : "active"); // opposite only for current
				} else {
					addEveryone("active");
					addEveryone("inactive");
				}

				// Team members (non -ext/-team/-int)
				const members: any[] = (team.members ?? []).filter((m: any) => {
					const a = (m.alias || "").toLowerCase();
					return a && !a.endsWith("-ext") && !a.endsWith("-team") && !a.endsWith("-int");
				});

				const addMember = (mem: any, v: "active" | "inactive") => {
					menu.addItem((i) => {
						i.setTitle(`${mem.name} (${v})`);
						i.onClick(() => {
							const before = editor.getLine(lineNo);
							const oldAlias = ctx.getExplicitAssigneeAliasFromText(before);
							ctx.applyAssigneeChangeWithCascade(filePath, editor, lineNo, oldAlias, mem.alias, v, team)
								.finally(() => editor.setCursor(savedCursor));
						});
					});
				};

				for (const mem of members) {
					if ((mem.alias || "").toLowerCase() === alias) {
						// Current member: offer opposite variant only
						addMember(mem, variant === "active" ? "inactive" : "active");
					} else {
						// Other members: offer both variants
						addMember(mem, "active");
						addMember(mem, "inactive");
					}
				}
			} else if (isDelegate) {
				// Disallow if assigned to Everyone
				if (/\bclass="(?:active|inactive)-team"\b/i.test(currentLine)) {
					return;
				}

				// Remove Delegation option
				menu.addItem((i) => {
					i.setTitle("Remove Delegation");
					i.onClick(() => {
						const before = editor.getLine(lineNo);
						let updated = ctx.normalizeTaskLine(before, { newDelegateMark: null });
						if (/<\/mark>\s*$/.test(updated)) updated = updated.replace(/\s*$/, " ");
						editor.replaceRange(updated, { line: lineNo, ch: 0 }, { line: lineNo, ch: before.length });
						editor.setCursor(savedCursor);
					});
				});

				const dVariant = "active" as const; // Delegates can only be active

				// Internal Teams (-team but not bare 'team')
				const internalTeams: any[] = (team.members ?? []).filter((m: any) => {
					const a = (m.alias || "").toLowerCase();
					return a.endsWith("-team") && a !== "team";
				});
				for (const t of internalTeams) {
					menu.addItem((i) => {
						i.setTitle(t.name);
						i.onClick(() => {
							const before = editor.getLine(lineNo);
							let updated = ctx.normalizeTaskLine(before, {
								newDelegateMark: renderDelegateMark(t.alias, t.name, dVariant, "team"),
							});
							if (/<\/mark>\s*$/.test(updated)) updated = updated.replace(/\s*$/, " ");
							editor.replaceRange(updated, { line: lineNo, ch: 0 }, { line: lineNo, ch: before.length });
							editor.setCursor(savedCursor);
						});
					});
				}

				// Internal Members (-int)
				const internalMembers: any[] = (team.members ?? []).filter((m: any) =>
					(m.alias || "").toLowerCase().endsWith("-int")
				);
				for (const im of internalMembers) {
					menu.addItem((i) => {
						i.setTitle(im.name);
						i.onClick(() => {
							const before = editor.getLine(lineNo);
							let updated = ctx.normalizeTaskLine(before, {
								newDelegateMark: renderDelegateMark(im.alias, im.name, dVariant, "internal"),
							});
							if (/<\/mark>\s*$/.test(updated)) updated = updated.replace(/\s*$/, " ");
							editor.replaceRange(updated, { line: lineNo, ch: 0 }, { line: lineNo, ch: before.length });
							editor.setCursor(savedCursor);
						});
					});
				}

				// External Delegates (-ext)
				const externals: any[] = (team.members ?? []).filter((m: any) =>
					(m.alias || "").toLowerCase().endsWith("-ext")
				);
				for (const ex of externals) {
					menu.addItem((i) => {
						i.setTitle(ex.name);
						i.onClick(() => {
							const before = editor.getLine(lineNo);
							let updated = ctx.normalizeTaskLine(before, {
								newDelegateMark: renderDelegateMark(ex.alias, ex.name, dVariant, "external"),
							});
							if (/<\/mark>\s*$/.test(updated)) updated = updated.replace(/\s*$/, " ");
							editor.replaceRange(updated, { line: lineNo, ch: 0 }, { line: lineNo, ch: before.length });
							editor.setCursor(savedCursor);
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

	document.addEventListener("mousedown", mousedown as EventListener, { capture: true });
	document.addEventListener("click", click as EventListener, { capture: true });

	return () => {
		document.removeEventListener("mousedown", mousedown as EventListener, { capture: true } as any);
		document.removeEventListener("click", click as EventListener, { capture: true } as any);
	};
}
