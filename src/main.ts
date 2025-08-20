import {
	App,
	Editor,
	MarkdownView,
	Modal,
	Plugin,
	TFile,
	WorkspaceLeaf,
	Menu,
} from "obsidian";

import {
	AgileObsidianSettings,
	AgileSettingTab,
	DEFAULT_SETTINGS,
} from "./settings";
import {
	AgileDashboardView,
	VIEW_TYPE_AGILE_DASHBOARD,
} from "./views/AgileDashboardView";
import { TaskIndex } from "./index/TaskIndex";
import checkboxCss from "./styles/checkboxes.css";
import {
	isUncheckedTaskLine,
	resolveTeamForPath,
	hasAnyTeamMemberAssignment,
	aliasToName,
	escapeRegExp,
} from "./utils/commands/commandUtils";
import { normalizeTaskLine } from "./utils/format/taskFormatter";

export default class AgileObsidianPlugin extends Plugin {
	settings: AgileObsidianSettings;
	taskIndex: TaskIndex;
	private checkboxStyleEl?: HTMLStyleElement;
	private dynamicCommandIds: Set<string> = new Set();
	private formattingFiles: Set<string> = new Set();
	private lastActiveFilePath: string | null = null;
	private optimisticBeforeContent: Map<string, string[]> = new Map();

	private async injectCheckboxStyles(): Promise<void> {
		try {
			// Remove any existing style we added (hot reload safety)
			document
				.querySelectorAll(`style[data-agile-checkbox-styles="${this.manifest.id}"]`)
				.forEach((el) => el.parentElement?.removeChild(el));

			const styleEl = document.createElement("style");
			styleEl.setAttribute("data-agile-checkbox-styles", this.manifest.id);
			styleEl.textContent = checkboxCss;

			document.head.appendChild(styleEl);
			this.checkboxStyleEl = styleEl;
		} catch (e) {
			// no-op
			void e;
		}
	}

	

	// Determine the target line corresponding to a clicked <mark> in Live Preview without moving the cursor.
	private findTargetLineFromClick(editor: Editor, evt: MouseEvent, alias: string): number {
		let lineNo = editor.getCursor().line; // fallback
		try {
			const cm: any = (editor as any).cm;
			if (cm && typeof cm.posAtCoords === "function") {
				const posOrOffset = cm.posAtCoords({ x: evt.clientX, y: evt.clientY });
				if (posOrOffset != null) {
					const pos = typeof posOrOffset === "number" ? editor.offsetToPos(posOrOffset) : ("pos" in posOrOffset ? editor.offsetToPos(posOrOffset.pos) : posOrOffset);
					if (pos && typeof pos.line === "number") {
						lineNo = pos.line;
						return lineNo;
					}
				}
			}
		} catch (err) { void err; }
		// Fallback: find a unique line containing this alias class
		try {
			const signature = new RegExp(`\\bclass="(?:active|inactive)-${escapeRegExp(alias)}"\\b`, "i");
			const lines = editor.getValue().split("\n");
			const matches: number[] = [];
			for (let i = 0; i < lines.length; i++) {
				if (isUncheckedTaskLine(lines[i]) && signature.test(lines[i])) matches.push(i);
			}
			if (matches.length === 1) return matches[0];
		} catch (err) { void err; }
		return lineNo;
	}

	// Extract the explicit assignee alias from a task line, or null if none.
	private getExplicitAssigneeAliasFromText(line: string): string | null {
		try {
			// Everyone (alias exactly "team")
			if (/\bclass="(?:active|inactive)-team"\b/i.test(line)) return "team";
			// Member assignee (👋 ...)
			const m = /\bclass="(?:active|inactive)-([a-z0-9-]+)"[^>]*>\s*<strong>👋/i.exec(line);
			return m ? m[1].toLowerCase() : null;
		} catch {
			return null;
		}
	}

	// Looser unchecked-task detection that accepts missing space after the bracket and multiple spaces inside.
	private isUncheckedTaskLineLoose(line: string): boolean {
		try {
			// unchecked if brackets contain only whitespace (including empty), and starts with "- [ ]"
			return /^\s*-\s\[\s*\]/.test(line);
		} catch {
			return false;
		}
	}

	// Build an assignee <mark> HTML for an alias.
	private buildAssigneeMarkForAlias(alias: string, variant: "active" | "inactive", team: any): string {
		const lower = (alias || "").toLowerCase();
		if (lower === "team") {
			const bg = variant === "active" ? "#FFFFFF" : "#CACFD9A6";
			return `<mark class="${variant}-team" style="background: ${bg}; color: #000000"><strong>🤝 Everyone</strong></mark>`;
		}
		const member = (team?.members ?? []).find((m: any) => (m.alias || "").toLowerCase() === lower);
		const name = member?.name || aliasToName(alias);
		const bg = variant === "active" ? "#BBFABBA6" : "#CACFD9A6";
		return `<mark class="${variant}-${alias}" style="background: ${bg};"><strong>👋 ${name}</strong></mark>`;
	}

	// Apply an assignee change on a specific line and then cascade adjustments across descendants.
	private async applyAssigneeChangeWithCascade(
		filePath: string,
		editor: Editor,
		lineNo: number,
		oldAlias: string | null,
		newAlias: string | null,
		variant: "active" | "inactive",
		team: any
	): Promise<void> {
		// Capture content BEFORE making any edits, to compute cascade correctly
		const beforeLines = editor.getValue().split("\n");

		// Update the target line first
		const originalLine = editor.getLine(lineNo);
		const newMark = newAlias ? this.buildAssigneeMarkForAlias(newAlias, variant, team) : null;
		let updated = normalizeTaskLine(originalLine, { newAssigneeMark: newMark });
		if (/<\/mark>\s*$/.test(updated)) updated = updated.replace(/\s*$/, " ");
		editor.replaceRange(updated, { line: lineNo, ch: 0 }, { line: lineNo, ch: originalLine.length });

		// Ensure TaskIndex is up-to-date for this file structure before cascade/redundancy checks
		try {
			const af = this.app.vault.getAbstractFileByPath(filePath);
			if (af instanceof TFile) {
				await this.taskIndex.updateFile(af);
			}
		} catch (err) { void err; }

		// If the new explicit assignee equals the inherited value from ancestors, remove the explicit mark (redundant)
		try {
			const fileEntry = this.taskIndex.getIndex()?.[filePath];
			if (fileEntry) {
				const allTextNow = editor.getValue();
				const linesNow = allTextNow.split("\n");

				// Build line->item and id->item maps from index
				const byLine = new Map<number, any>();
				const byId = new Map<string, any>();
				const collect = (items: any[]) => {
					for (const it of items) {
						const l0 = (it.line ?? 1) - 1;
						byLine.set(l0, it);
						if (it._uniqueId) byId.set(it._uniqueId, it);
						if (Array.isArray(it.children)) collect(it.children);
					}
				};
				collect(fileEntry.lists || []);

				const aliasNow: (string | null)[] = linesNow.map((ln) =>
					isUncheckedTaskLine(ln) ? this.getExplicitAssigneeAliasFromText(ln) : null
				);

				const nearestUp = (l0: number, aliasMap: (string | null)[]): string | null => {
					let cur = byLine.get(l0);
					while (cur) {
						const parentId = cur._parentId;
						if (!parentId) return null;
						const parent = byId.get(parentId);
						if (!parent) return null;
						const pLine0 = (parent.line ?? 1) - 1;
						const v = aliasMap[pLine0];
						if (v) return v;
						cur = parent;
					}
					return null;
				};

				const explicitOnLine = aliasNow[lineNo];
				if (explicitOnLine) {
					// Compute inherited ignoring self
					const saved = aliasNow[lineNo];
					aliasNow[lineNo] = null;
					const inherited = nearestUp(lineNo, aliasNow);
					aliasNow[lineNo] = saved;

					if (inherited && inherited.toLowerCase() === explicitOnLine.toLowerCase()) {
						const after = editor.getLine(lineNo);
						let cleaned = normalizeTaskLine(after, { newAssigneeMark: null });
						if (/<\/mark>\s*$/.test(cleaned)) cleaned = cleaned.replace(/\s*$/, " ");
						editor.replaceRange(cleaned, { line: lineNo, ch: 0 }, { line: lineNo, ch: after.length });
					}
				}
			}
		} catch (err) { void err; }

		// Then cascade adjustments (computed against the pre-edit snapshot)
		await this.applyAssigneeCascade(filePath, editor, lineNo, oldAlias, newAlias, team, beforeLines);
	}

	// Ensure effective assignments remain constant across descendants after a parent assignment change.
	private async applyAssigneeCascade(
		filePath: string,
		editor: Editor,
		parentLineNo: number,
		oldAlias: string | null,
		newAlias: string | null,
		team: any,
		beforeLines?: string[]
	): Promise<void> {
		try {
			if (oldAlias === newAlias) return;

			// Build alias maps before and after parent change (use pre-edit snapshot if provided)
			const lines = (beforeLines ?? editor.getValue().split("\n"));

			// Ensure we have an index entry for this file before proceeding
			try {
				const af = this.app.vault.getAbstractFileByPath(filePath);
				if (af instanceof TFile) {
					await this.taskIndex.updateFile(af);
				}
			} catch (err) { void err; }

			// Acquire the indexed tree for this file
			const fileEntry = this.taskIndex.getIndex()?.[filePath];
			if (!fileEntry) return;

			// Map line(0-based) -> TaskItem, and id -> TaskItem
			const byLine = new Map<number, any>();
			const byId = new Map<string, any>();
			const collect = (items: any[]) => {
				for (const it of items) {
					const l0 = (it.line ?? 1) - 1;
					byLine.set(l0, it);
					if (it._uniqueId) byId.set(it._uniqueId, it);
					if (Array.isArray(it.children)) collect(it.children);
				}
			};
			collect(fileEntry.lists || []);

			const parentItem = byLine.get(parentLineNo);
			if (!parentItem) return;

			// Collect descendant line numbers (0-based) under the parent
			const descendants: number[] = [];
			const dfs = (it: any) => {
				for (const ch of it.children || []) {
					const l0 = (ch.line ?? 1) - 1;
					descendants.push(l0);
					dfs(ch);
				}
			};
			dfs(parentItem);

			// Helper: explicit alias on a line
			const explicitAliasOn = (l0: number) =>
				isUncheckedTaskLine(lines[l0] || "") ? this.getExplicitAssigneeAliasFromText(lines[l0] || "") : null;

			const aliasBefore: (string | null)[] = lines.map((_, i) => explicitAliasOn(i));
			const aliasAfter: (string | null)[] = aliasBefore.slice();
			aliasAfter[parentLineNo] = newAlias; // parent updated

			// Resolve nearest ancestor explicit alias for a given line, using a given alias map
			const nearestUp = (l0: number, aliasMap: (string | null)[]): string | null => {
				let cur = byLine.get(l0);
				while (cur) {
					const line0 = (cur.line ?? 1) - 1;
					const v = aliasMap[line0];
					if (v) return v;
					const pid = cur._parentId;
					cur = pid ? byId.get(pid) : null;
				}
				return null;
			};
			// Variant that also returns the source ancestor line that provided the alias
			const nearestUpWithSource = (
				l0: number,
				aliasMap: (string | null)[]
			): { alias: string | null; source: number | null } => {
				let cur = byLine.get(l0);
				while (cur) {
					const line0 = (cur.line ?? 1) - 1;
					const v = aliasMap[line0];
					if (v) return { alias: v, source: line0 };
					const pid = cur._parentId;
					cur = pid ? byId.get(pid) : null;
				}
				return { alias: null, source: null };
			};

			// Pass 1: preserve previous effective assignment for each descendant
			const toSetExplicit = new Map<number, string>(); // line -> alias to set
			for (const d of descendants) {
				if (!isUncheckedTaskLine(lines[d] || "")) continue;

				const explicitD = aliasBefore[d];
				const prevEff = explicitD ?? nearestUp(d, aliasBefore);
				const newEffCandidate = (explicitD ?? nearestUp(d, aliasAfter)) || null;

				if (prevEff !== newEffCandidate) {
					if (prevEff) {
						toSetExplicit.set(d, prevEff);
						aliasAfter[d] = prevEff; // reflect the planned explicit addition
					}
				} else {
					// If effective assignment stayed the same, but it was previously INFERRED
					// from the changed ancestor (parentLineNo), make it explicit to preserve intent.
					if (!explicitD && prevEff) {
						const beforeSrc = nearestUpWithSource(d, aliasBefore).source;
						if (beforeSrc === parentLineNo) {
							toSetExplicit.set(d, prevEff);
							aliasAfter[d] = prevEff;
						}
					}
				}
			}

			// Pass 2: remove redundant explicits that now match inherited value
			const toRemoveExplicit = new Set<number>();
			for (const d of descendants) {
				if (!isUncheckedTaskLine(lines[d] || "")) continue;

				const explicitD = aliasAfter[d];
				if (!explicitD) continue;

				// Compute inherited alias if this line had no explicit (exclude self)
				const saved = aliasAfter[d];
				aliasAfter[d] = null;
				const inherited = nearestUp(d, aliasAfter);
				aliasAfter[d] = saved;

				if (inherited && inherited === explicitD) {
					// If we just added this explicit in pass 1 to preserve a different assignment, skip removal
					const wasAdded = toSetExplicit.has(d);
					if (!wasAdded) toRemoveExplicit.add(d);
				}
			}

			// Apply changes to editor
			for (const [lineNo, alias] of toSetExplicit.entries()) {
				const orig = editor.getLine(lineNo);
				const mark = this.buildAssigneeMarkForAlias(alias, "active", team);
				let upd = normalizeTaskLine(orig, { newAssigneeMark: mark });
				if (/<\/mark>\s*$/.test(upd)) upd = upd.replace(/\s*$/, " ");
				editor.replaceRange(upd, { line: lineNo, ch: 0 }, { line: lineNo, ch: orig.length });
			}

			for (const lineNo of toRemoveExplicit) {
				const orig = editor.getLine(lineNo);
				let upd = normalizeTaskLine(orig, { newAssigneeMark: null });
				if (/<\/mark>\s*$/.test(upd)) upd = upd.replace(/\s*$/, " ");
				editor.replaceRange(upd, { line: lineNo, ch: 0 }, { line: lineNo, ch: orig.length });
			}
		} catch (err) { void err; }
	}

	private unregisterDynamicCommands(): void {
		try {
			// @ts-ignore - commands API not in public types
			const cmds = this.app.commands;
			for (const id of this.dynamicCommandIds) {
				try {
					// @ts-ignore
					cmds.removeCommand(id);
				} catch (err) { void err; }
			}
		} finally {
			this.dynamicCommandIds.clear();
		}
	}

	private rebuildDynamicCommands(): void {
		this.unregisterDynamicCommands();

		const teams: any[] = (this.settings as any)?.teams ?? [];
		if (!teams || teams.length === 0) return;

		for (const team of teams) {
			this.addAssignCommandsForTeam(team);
			this.addDelegateCommandsForTeam(team);
		}
	}

	private addAssignCommandsForTeam(team: any): void {
		const teamName: string = team.name;
		const members: any[] = (team.members ?? []).filter((m: any) => {
			const a = (m.alias || "").toLowerCase();
			return a && !a.endsWith("-ext") && !a.endsWith("-team") && !a.endsWith("-int");
		});

		// Everyone (special) assignments
		this.createAssignEveryoneCommand(teamName, "active");
		this.createAssignEveryoneCommand(teamName, "inactive");

		// "to me" if identity set and is part of this team
		const meAlias = ((this.settings as any)?.currentUserAlias || "").trim();
		const meMember = members.find((m) => (m.alias || "").trim() === meAlias);
		if (meMember) {
			this.createAssignCommand(teamName, meMember.alias, meMember.name, "active", true);
			this.createAssignCommand(teamName, meMember.alias, meMember.name, "inactive", true);
		}

		// For other members
		for (const m of members) {
			const isMe = meAlias && m.alias === meAlias;
			// Skip duplicates: already handled above for "me"
			if (isMe) continue;
			this.createAssignCommand(teamName, m.alias, m.name, "active", false);
			this.createAssignCommand(teamName, m.alias, m.name, "inactive", false);
		}
	}

	private addDelegateCommandsForTeam(team: any): void {
		const teamName: string = team.name;

		// Internal Teams (-team)
		for (const m of team.members ?? []) {
			const alias = (m.alias || "").toLowerCase();
			if (alias.endsWith("-team")) {
				this.createDelegateCommand(teamName, m.alias, m.name, "team", "active");
				this.createDelegateCommand(teamName, m.alias, m.name, "team", "inactive");
			}
		}

		// Internal Team Members (-int)
		for (const m of team.members ?? []) {
			const alias = (m.alias || "").toLowerCase();
			if (alias.endsWith("-int")) {
				this.createDelegateCommand(teamName, m.alias, m.name, "internal", "active");
				this.createDelegateCommand(teamName, m.alias, m.name, "internal", "inactive");
			}
		}

		// External Delegates (-ext)
		for (const m of team.members ?? []) {
			const alias = (m.alias || "").toLowerCase();
			if (alias.endsWith("-ext")) {
				this.createDelegateCommand(teamName, m.alias, m.name, "external", "active");
				this.createDelegateCommand(teamName, m.alias, m.name, "external", "inactive");
			}
		}
	}

	private createAssignCommand(
		teamName: string,
		memberAlias: string,
		memberName: string,
		variant: "active" | "inactive",
		isMe: boolean
	) {
		const id = `${this.manifest.id}:assign:${teamName}:${memberAlias}:${variant}`;
		const title = isMe
			? `Assign: to me - ${memberName} (${variant})`
			: `Assign: to ${memberName} (${variant})`;

		// @ts-ignore - types for id not strictly enforced
		this.addCommand({
			id,
			name: title,
			editorCheckCallback: (checking: boolean, editor: Editor, view: MarkdownView) => {
				const filePath = view?.file?.path ?? null;
				if (!filePath) return false;
				const team = resolveTeamForPath(filePath, (this.settings as any)?.teams ?? []);
				if (!team || team.name !== teamName) return false;

				// Show the command whenever we're in a note for this team
				if (checking) return true;

				// Only execute when the cursor is on an unchecked task line
				const pos = editor.getCursor();
				const line = editor.getLine(pos.line);
				if (!this.isUncheckedTaskLineLoose(line)) return false;

				const oldAlias = this.getExplicitAssigneeAliasFromText(line);
				void import("./assignees/assignmentCascade").then(async ({ applyAssigneeChangeWithCascade }) => {
					try {
						await applyAssigneeChangeWithCascade(
							filePath,
							editor,
							pos.line,
							oldAlias,
							memberAlias,
							variant,
							team,
							{
								app: this.app,
								taskIndex: this.taskIndex,
								normalizeTaskLine,
								isUncheckedTaskLine: (l: string) => this.isUncheckedTaskLineLoose(l),
								getExplicitAssigneeAliasFromText: (l: string) => this.getExplicitAssigneeAliasFromText(l),
								buildAssigneeMarkForAlias: (a: string, v: "active" | "inactive", t: any) =>
									this.buildAssigneeMarkForAlias(a, v, t),
							}
						);
					} catch (e) {
						void e;
					}
				});

				return true;
			},
		});

		this.dynamicCommandIds.add(id);
	}

	private createAssignEveryoneCommand(
		teamName: string,
		variant: "active" | "inactive"
	) {
		const id = `${this.manifest.id}:assign:${teamName}:everyone:${variant}`;
		const title = `Assign: to Everyone (${variant})`;

		// @ts-ignore - types for id not strictly enforced
		this.addCommand({
			id,
			name: title,
			editorCheckCallback: (checking: boolean, editor: Editor, view: MarkdownView) => {
				const filePath = view?.file?.path ?? null;
				if (!filePath) return false;
				const team = resolveTeamForPath(filePath, (this.settings as any)?.teams ?? []);
				if (!team || team.name !== teamName) return false;

				// Show the command whenever we're in a note for this team
				if (checking) return true;

				// Only execute when the cursor is on an unchecked task line
				const pos = editor.getCursor();
				const line = editor.getLine(pos.line);
				if (!this.isUncheckedTaskLineLoose(line)) return false;

				const oldAlias = this.getExplicitAssigneeAliasFromText(line);
				// Everyone alias is exactly "team"
				void import("./assignees/assignmentCascade").then(async ({ applyAssigneeChangeWithCascade }) => {
					try {
						await applyAssigneeChangeWithCascade(
							filePath,
							editor,
							pos.line,
							oldAlias,
							"team",
							variant,
							team,
							{
								app: this.app,
								taskIndex: this.taskIndex,
								normalizeTaskLine,
								isUncheckedTaskLine: (l: string) => this.isUncheckedTaskLineLoose(l),
								getExplicitAssigneeAliasFromText: (l: string) => this.getExplicitAssigneeAliasFromText(l),
								buildAssigneeMarkForAlias: (a: string, v: "active" | "inactive", t: any) =>
									this.buildAssigneeMarkForAlias(a, v, t),
							}
						);
					} catch (e) {
						void e;
					}
				});

				return true;
			},
		});

		this.dynamicCommandIds.add(id);
	}

	private createDelegateCommand(
		teamName: string,
		targetAlias: string,
		targetName: string,
		targetType: "team" | "internal" | "external",
		variant: "active" | "inactive"
	) {
		const id = `${this.manifest.id}:delegate:${teamName}:${targetType}:${targetAlias}:${variant}`;

		const emoji = targetType === "team" ? "🤝" : targetType === "internal" ? "👥" : "👤";
		const title = `/Delegate: to ${targetName} (${variant})`;

		const bg =
			variant === "active"
				? targetType === "team"
					? "#008080"
					: targetType === "internal"
					? "#687D70"
					: "#FA9684"
				: "#CACFD9A6";

		const newDelegateMark = `<mark class="${variant}-${targetAlias}" style="background: ${bg};"><strong>${emoji} ${targetName}</strong></mark>`;

		// @ts-ignore - types for id not strictly enforced
		this.addCommand({
			id,
			name: title,
			editorCheckCallback: (checking: boolean, editor: Editor, view: MarkdownView) => {
				const filePath = view?.file?.path ?? null;
				if (!filePath) return false;
				const team = resolveTeamForPath(filePath, (this.settings as any)?.teams ?? []);
				if (!team || team.name !== teamName) return false;

				// Show the command whenever we're in a note for this team
				if (checking) {
					// If we're looking at a task assigned to Everyone ("team"), hide delegation commands
					const pos = editor.getCursor();
					const line = editor.getLine(pos.line);
					if (this.isUncheckedTaskLineLoose(line)) {
						const alias = this.getExplicitAssigneeAliasFromText(line);
						if ((alias || "").toLowerCase() === "team") return false;
					}
					return true;
				}

				const pos = editor.getCursor();
				const line = editor.getLine(pos.line);
				// Only execute when the cursor is on an unchecked task line
				if (!this.isUncheckedTaskLineLoose(line)) return false;

				// Only after an assignment to a team member exists
				if (!hasAnyTeamMemberAssignment(line, team)) return false;

				let updated = normalizeTaskLine(line, { newDelegateMark: newDelegateMark });
				// If we just added a delegate and the line ends with the <mark>, add a trailing space
				// so Live Preview renders the HTML block (cursor is placed outside the HTML).
				if (/<\/mark>\s*$/.test(updated)) {
					updated = updated.replace(/\s*$/, " ");
				}

				editor.replaceRange(
					updated,
					{ line: pos.line, ch: 0 },
					{ line: pos.line, ch: line.length }
				);

				return true;
			},
		});

		this.dynamicCommandIds.add(id);
	}

	async onload() {
		// Load settings early (must come before adding the tab)
		await this.loadSettings();
		await this.applyCheckboxStylesSetting();
		await this.detectAndUpdateTeams();

		// Add the settings tab
		this.addSettingTab(new AgileSettingTab(this.app, this));

		this.taskIndex = TaskIndex.getInstance(this.app);
		await this.taskIndex.buildIndex();

		this.registerView(
			VIEW_TYPE_AGILE_DASHBOARD,
			(leaf) => new AgileDashboardView(leaf, this) // Updated: Pass 'this' (the plugin instance) for settings access
		);

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon(
			"logs", // Icon name (matches the view's icon)
			"Open Agile Obsidian Dashboard",
			() => {
				// Called when the user clicks the icon.
				this.activateView(); // Opens the blank dashboard leaf
			}
		);
		// Perform additional things with the ribbon (optional)
		ribbonIconEl.addClass("agile-dashboard-ribbon-class");

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText("Status Bar Text");

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: "open-sample-modal-simple",
			name: "Open sample modal (simple)",
			callback: () => {
				new SampleModal(this.app).open();
			},
		});
		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: "sample-editor-command",
			name: "Sample editor command",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				console.log(editor.getSelection());
				editor.replaceSelection("Sample Editor Command");
			},
		});
		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: "open-sample-modal-complex",
			name: "Open sample modal (complex)",
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						new SampleModal(this.app).open();
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			},
		});

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		const showAssignDelegateMenu = async (evt: MouseEvent, markEl: HTMLElement) => {
			try {
				const classAttr = markEl.getAttribute("class") || "";
				const m = /\b(active|inactive)-([a-z0-9-]+)\b/i.exec(classAttr);
				if (!m) return;
				const variant = (m[1] as "active" | "inactive");
				const alias = m[2].toLowerCase();

				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view) return;
				const editor = view.editor;
				const filePath = view?.file?.path ?? null;
				if (!filePath) return;

				const team = resolveTeamForPath(filePath, (this.settings as any)?.teams ?? []);
				if (!team) return;

				// Determine the actual line for the clicked mark and preserve the current cursor
				const savedCursor = editor.getCursor();
				const lineNo = this.findTargetLineFromClick(editor, evt, alias);
				const currentLine = editor.getLine(lineNo);
				if (!isUncheckedTaskLine(currentLine)) return;

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
							const oldAlias = this.getExplicitAssigneeAliasFromText(before);
							void import("./assignees/assignmentCascade").then(async ({ applyAssigneeChangeWithCascade }) => {
								try {
									await applyAssigneeChangeWithCascade(
										filePath,
										editor,
										lineNo,
										oldAlias,
										null,
										"active",
										team,
										{
											app: this.app,
											taskIndex: this.taskIndex,
											normalizeTaskLine,
											isUncheckedTaskLine: (l: string) => this.isUncheckedTaskLineLoose(l),
											getExplicitAssigneeAliasFromText: (l: string) => this.getExplicitAssigneeAliasFromText(l),
											buildAssigneeMarkForAlias: (a: string, v: "active" | "inactive", t: any) =>
												this.buildAssigneeMarkForAlias(a, v, t),
										}
									);
									// Also remove any delegation mark when clearing assignee
									const afterLine = editor.getLine(lineNo);
									let cleaned = normalizeTaskLine(afterLine, { newDelegateMark: null });
									if (/<\/mark>\s*$/.test(cleaned)) cleaned = cleaned.replace(/\s*$/, " ");
									if (cleaned !== afterLine) {
										editor.replaceRange(
											cleaned,
											{ line: lineNo, ch: 0 },
											{ line: lineNo, ch: afterLine.length }
										);
									}
								} finally {
									// Restore cursor exactly
									editor.setCursor(savedCursor);
								}
							});
						});
					});

					// Everyone options
					const addEveryone = (v: "active" | "inactive") => {
						menu.addItem((i) => {
							i.setTitle(`Everyone (${v})`);
							i.onClick(() => {
								const before = editor.getLine(lineNo);
								const oldAlias = this.getExplicitAssigneeAliasFromText(before);
								void import("./assignees/assignmentCascade").then(async ({ applyAssigneeChangeWithCascade }) => {
									try {
										await applyAssigneeChangeWithCascade(
											filePath,
											editor,
											lineNo,
											oldAlias,
											"team",
											v,
											team,
											{
												app: this.app,
												taskIndex: this.taskIndex,
												normalizeTaskLine,
												isUncheckedTaskLine: (l: string) => this.isUncheckedTaskLineLoose(l),
												getExplicitAssigneeAliasFromText: (l: string) => this.getExplicitAssigneeAliasFromText(l),
												buildAssigneeMarkForAlias: (a: string, vv: "active" | "inactive", t: any) =>
													this.buildAssigneeMarkForAlias(a, vv, t),
											}
										);
									} finally {
										editor.setCursor(savedCursor);
									}
								});
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
								const oldAlias = this.getExplicitAssigneeAliasFromText(before);
								void import("./assignees/assignmentCascade").then(async ({ applyAssigneeChangeWithCascade }) => {
									try {
										await applyAssigneeChangeWithCascade(
											filePath,
											editor,
											lineNo,
											oldAlias,
											mem.alias,
											v,
											team,
											{
												app: this.app,
												taskIndex: this.taskIndex,
												normalizeTaskLine,
												isUncheckedTaskLine: (l: string) => this.isUncheckedTaskLineLoose(l),
												getExplicitAssigneeAliasFromText: (l: string) => this.getExplicitAssigneeAliasFromText(l),
												buildAssigneeMarkForAlias: (a: string, vv: "active" | "inactive", t: any) =>
													this.buildAssigneeMarkForAlias(a, vv, t),
											}
										);
									} finally {
										editor.setCursor(savedCursor);
									}
								});
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
							let updated = normalizeTaskLine(before, { newDelegateMark: null });
							if (/<\/mark>\s*$/.test(updated)) updated = updated.replace(/\s*$/, " ");
							editor.replaceRange(updated, { line: lineNo, ch: 0 }, { line: lineNo, ch: before.length });
							editor.setCursor(savedCursor);
						});
					});

					const pickEmojiAndBg = (type: "team" | "internal" | "external") => {
						const emoji = type === "team" ? "🤝" : type === "internal" ? "👥" : "👤";
						const bg = type === "team" ? "#008080" : type === "internal" ? "#687D70" : "#FA9684";
						return { emoji, bg };
					};
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
								const { emoji, bg } = pickEmojiAndBg("team");
								let updated = normalizeTaskLine(before, {
									newDelegateMark: `<mark class="${dVariant}-${t.alias}" style="background: ${bg};"><strong>${emoji} ${t.name}</strong></mark>`,
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
								const { emoji, bg } = pickEmojiAndBg("internal");
								let updated = normalizeTaskLine(before, {
									newDelegateMark: `<mark class="${dVariant}-${im.alias}" style="background: ${bg};"><strong>${emoji} ${im.name}</strong></mark>`,
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
								const { emoji, bg } = pickEmojiAndBg("external");
								let updated = normalizeTaskLine(before, {
									newDelegateMark: `<mark class="${dVariant}-${ex.alias}" style="background: ${bg};"><strong>${emoji} ${ex.name}</strong></mark>`,
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
			} catch (err) { void err; }
		};

		// Use mousedown (capturing) to suppress Live Preview HTML opening on single click; allow double-click to edit as normal.
		this.registerDomEvent(
			document,
			"mousedown",
			(evt: MouseEvent) => {
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
					evt.stopImmediatePropagation?.();

					// Preserve cursor in the active editor (if any)
					const view = this.app.workspace.getActiveViewOfType(MarkdownView);
					const savedCursor = view?.editor.getCursor();

					// Show menu asynchronously to avoid blocking default handling
					showAssignDelegateMenu(evt, markEl);

					// Restore cursor position on next frame (in case the editor moved it)
					if (view && savedCursor) {
						requestAnimationFrame(() => {
							try {
								// Only restore if the same editor is still active
								const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
								if (activeView && activeView === view) {
									view.editor.setCursor(savedCursor);
								}
							} catch (e) { void e; }
						});
					}
				}
				// Double-click: let Obsidian handle (to edit raw HTML)
			},
			{ capture: true }
		);

		// Click handler (capturing): if we already handled via mousedown (single click), swallow the event.
		this.registerDomEvent(
			document,
			"click",
			(evt: MouseEvent) => {
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
					evt.stopImmediatePropagation?.();
				}
			},
			{ capture: true }
		);

		// Capture content snapshot before optimistic external edits (e.g., from dashboard)
		{
			const handler = async (ev: Event) => {
				try {
					const ce = ev as CustomEvent<any>;
					const filePath = ce?.detail?.filePath as string;
					if (!filePath) return;
					const af = this.app.vault.getAbstractFileByPath(filePath);
					if (af instanceof TFile) {
						const content = await this.app.vault.cachedRead(af);
						this.optimisticBeforeContent.set(filePath, content.split("\n"));
						// Ensure TaskIndex is up-to-date for this file structure
						await this.taskIndex.updateFile(af);
					}
				} catch (err) {
					void err;
				}
			};
			window.addEventListener("agile:prepare-optimistic-file-change", handler as EventListener);
			this.register(() => {
				window.removeEventListener("agile:prepare-optimistic-file-change", handler as EventListener);
			});
		}

		// After an external assignment completes, cascade explicit/redundant marks across descendants
		{
			const handler = async (ev: Event) => {
				try {
					const ce = ev as CustomEvent<any>;
					const detail = (ce && (ce as any).detail) || {};
					const uid: string | null = (detail?.uid as string) || null;
					const filePath: string | null =
						(detail?.filePath as string) || (uid && uid.includes(":") ? uid.split(":")[0] : null);
					if (!uid || !filePath) return;

					const linePart = uid.split(":")[1];
					const line1 = Number.parseInt(linePart || "", 10);
					if (!Number.isFinite(line1)) return;
					const parentLine0 = Math.max(0, line1 - 1);

					const newAlias: string | null =
						typeof detail?.newAlias === "string" ? (detail.newAlias as string) : null;

					const before = this.optimisticBeforeContent.get(filePath) ?? null;
					await this.applyCascadeAfterExternalChange(filePath, parentLine0, before, newAlias);
					this.optimisticBeforeContent.delete(filePath);
				} catch (err) {
					void err;
				}
			};
			window.addEventListener("agile:assignment-changed", handler as EventListener);
			this.register(() => {
				window.removeEventListener("agile:assignment-changed", handler as EventListener);
			});
		}

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(
			window.setInterval(() => console.log("setInterval"), 5 * 60 * 1000)
		);

		this.registerEvent(
			this.app.vault.on("modify", async (file) => {
				if (file instanceof TFile && file.extension === "md") {
					await this.taskIndex.updateFile(file);
					await this.autoFormatFile(file);
				}
			})
		);

		this.registerEvent(
			this.app.vault.on("create", async (file) => {
				if (file instanceof TFile && file.extension === "md") {
					await this.taskIndex.updateFile(file);
				}
			})
		);

		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (file instanceof TFile && file.extension === "md") {
					this.taskIndex.removeFile(file.path);
				}
			})
		);

		this.registerEvent(
			this.app.vault.on("rename", async (file, oldPath) => {
				if (file instanceof TFile && file.extension === "md") {
					this.taskIndex.removeFile(oldPath);
					await this.taskIndex.updateFile(file);
				}
			})
		);

		// When switching files, format the previously active file (now inactive) safely,
		// and also normalize the newly opened file right away (non-intrusively).
		this.registerEvent(
			this.app.workspace.on("file-open", async (file) => {
				try {
					const prev = this.lastActiveFilePath;
					const newPath = file?.path ?? null;
					if (prev && prev !== newPath) {
						const af = this.app.vault.getAbstractFileByPath(prev);
						if (af instanceof TFile && af.extension === "md") {
							await this.autoFormatFile(af);
						}
					}
					this.lastActiveFilePath = newPath;

					// Also check and format the file that was just opened
					if (file instanceof TFile && file.extension === "md") {
						await this.autoFormatFile(file);

						// After formatting, normalize redundant assignee marks in the active editor
						const view = this.app.workspace.getActiveViewOfType(MarkdownView);
						if (view && view.file?.path === file.path) {
							const editor = view.editor;
							try {
								const filePath = file.path;
								const fileEntry = this.taskIndex.getIndex()?.[filePath];
								if (fileEntry) {
									const savedCursor = editor.getCursor();
									const lines = editor.getValue().split("\n");

									// Build maps
									const byLine = new Map<number, any>();
									const byId = new Map<string, any>();
									const collect = (items: any[]) => {
										for (const it of items) {
											const l0 = (it.line ?? 1) - 1;
											byLine.set(l0, it);
											if (it._uniqueId) byId.set(it._uniqueId, it);
											if (Array.isArray(it.children)) collect(it.children);
										}
									};
									collect(fileEntry.lists || []);

									const aliasNow: (string | null)[] = lines.map((ln) =>
										isUncheckedTaskLine(ln) ? this.getExplicitAssigneeAliasFromText(ln) : null
									);

									const nearestUp = (l0: number, aliasMap: (string | null)[]): string | null => {
										let cur = byLine.get(l0);
										while (cur) {
											const parentId = cur._parentId;
											if (!parentId) return null;
											const parent = byId.get(parentId);
											if (!parent) return null;
											const pLine0 = (parent.line ?? 1) - 1;
											const v = aliasMap[pLine0];
											if (v) return v;
											cur = parent;
										}
										return null;
									};

									// Iterate in ascending order; after each removal update aliasNow
									const sortedLines = Array.from(byLine.keys()).sort((a, b) => a - b);
									for (const l0 of sortedLines) {
										const exp = aliasNow[l0];
										if (!exp) continue;
										// Only operate on unchecked tasks
										if (!isUncheckedTaskLine(lines[l0] || "")) continue;

										const saved = aliasNow[l0];
										aliasNow[l0] = null;
										const inherited = nearestUp(l0, aliasNow);
										aliasNow[l0] = saved;

										if (inherited && inherited.toLowerCase() === exp.toLowerCase()) {
											const before = editor.getLine(l0);
											let cleaned = normalizeTaskLine(before, { newAssigneeMark: null });
											if (/<\/mark>\s*$/.test(cleaned)) cleaned = cleaned.replace(/\s*$/, " ");
											editor.replaceRange(cleaned, { line: l0, ch: 0 }, { line: l0, ch: before.length });
											// Reflect change in local arrays
											lines[l0] = cleaned;
											aliasNow[l0] = null;
										}
									}
									// Restore cursor
									editor.setCursor(savedCursor);
								}
							} catch (err) { void err; }
						}
					}
				} catch (err) { void err; }
			})
		);

		// Initial dynamic command set
		this.rebuildDynamicCommands();

		// Rebuild dynamic commands whenever settings change
		this.registerEvent(
			// @ts-ignore - custom event name
			this.app.workspace.on("agile-settings-changed", () => {
				this.rebuildDynamicCommands();
			})
		);
	}

	onunload() {
		this.unregisterDynamicCommands();
		if (this.checkboxStyleEl && this.checkboxStyleEl.parentNode) {
			this.checkboxStyleEl.parentNode.removeChild(this.checkboxStyleEl);
			this.checkboxStyleEl = undefined;
		}
	}

	private removeCheckboxStyles(): void {
		try {
			document
				.querySelectorAll(`style[data-agile-checkbox-styles="${this.manifest.id}"]`)
				.forEach((el) => el.parentElement?.removeChild(el));
			this.checkboxStyleEl = undefined;
		} catch (e) {
			// no-op
			void e;
		}
	}

	public async applyCheckboxStylesSetting(): Promise<void> {
		if ((this.settings as any)?.useBundledCheckboxes) {
			await this.injectCheckboxStyles();
		} else {
			this.removeCheckboxStyles();
		}
	}

	private async autoFormatFile(file: TFile): Promise<void> {
		try {
			if (this.formattingFiles.has(file.path)) return;

			// If the file is currently active in an editor, apply non-intrusive, line-local edits
			// and NEVER touch the user's current line. This prevents cursor jumps while typing.
			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			const isActive = !!activeView && activeView.file?.path === file.path;

			if (isActive && activeView) {
				const editor = activeView.editor;
				const cursor = editor.getCursor();
				const currentContent = editor.getValue();
				const lines = currentContent.split("\n");

				let changed = false;
				const targets: number[] = [];

				for (let i = 0; i < lines.length; i++) {
					if (i === cursor.line) continue; // Defer formatting of the line the user is actively typing on
					const line = lines[i];
					if (isUncheckedTaskLine(line)) {
						const normalized = normalizeTaskLine(line, {});
						if (normalized !== line) {
							lines[i] = normalized;
							changed = true;
							targets.push(i);
						}
					}
				}

				if (changed) {
					const savedCursor = { ...cursor };
					for (const idx of targets) {
						const originalLine = editor.getLine(idx);
						if (originalLine !== lines[idx]) {
							editor.replaceRange(
								lines[idx],
								{ line: idx, ch: 0 },
								{ line: idx, ch: originalLine.length }
							);
						}
					}
					// Restore cursor position exactly
					editor.setCursor(savedCursor);
				}
				return;
			}

			// If not active, safe to rewrite the file as a whole.
			const current = await this.app.vault.cachedRead(file);
			const lines = current.split("\n");
			let changed = false;

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				if (isUncheckedTaskLine(line)) {
					const normalized = normalizeTaskLine(line, {});
					if (normalized !== line) {
						lines[i] = normalized;
						changed = true;
					}
				}
			}

			if (changed) {
				this.formattingFiles.add(file.path);
				try {
					await this.app.vault.modify(file, lines.join("\n"));
				} finally {
					this.formattingFiles.delete(file.path);
				}
			}
		} catch (err) { void err; }
	}

	private async applyCascadeAfterExternalChange(
		filePath: string,
		parentLine0: number,
		beforeLines: string[] | null,
		newAlias: string | null
	): Promise<void> {
		try {
			const af = this.app.vault.getAbstractFileByPath(filePath);
			if (!(af instanceof TFile)) return;

			// Ensure we have a current index for structure (parents/children)
			let fileEntry = this.taskIndex.getIndex()?.[filePath];
			if (!fileEntry) {
				await this.taskIndex.updateFile(af);
				fileEntry = this.taskIndex.getIndex()?.[filePath];
				if (!fileEntry) return;
			}

			// Build maps of line -> item and id -> item
			const byLine = new Map<number, any>();
			const byId = new Map<string, any>();
			const collect = (items: any[]) => {
				for (const it of items) {
					const l0 = (it.line ?? 1) - 1;
					byLine.set(l0, it);
					if (it._uniqueId) byId.set(it._uniqueId, it);
					if (Array.isArray(it.children)) collect(it.children);
				}
			};
			collect(fileEntry.lists || []);

			const parentItem = byLine.get(parentLine0);
			if (!parentItem) return;

			// Collect descendant line numbers (0-based) under the parent
			const descendants: number[] = [];
			const dfs = (it: any) => {
				for (const ch of it.children || []) {
					const l0 = (ch.line ?? 1) - 1;
					descendants.push(l0);
					dfs(ch);
				}
			};
			dfs(parentItem);

			// Before snapshot (for computing previous effective assignments)
			const before = beforeLines ?? (await this.app.vault.cachedRead(af)).split("\n");
			// After content (we'll apply our cascade edits on top of this)
			const afterContent = await this.app.vault.cachedRead(af);
			const lines = afterContent.split("\n");

			const explicitOn = (ln: string): string | null =>
				isUncheckedTaskLine(ln) ? this.getExplicitAssigneeAliasFromText(ln) : null;

			const aliasBefore: (string | null)[] = before.map((ln) => explicitOn(ln));
			const aliasAfter: (string | null)[] = lines.map((ln) => explicitOn(ln));

			// Reflect the changed parent explicit alias in aliasAfter for accurate inheritance
			aliasAfter[parentLine0] = newAlias;

			// Resolve nearest ancestor explicit alias for a given line, using a given alias map
			const nearestUp = (l0: number, aliasMap: (string | null)[]): string | null => {
				let cur = byLine.get(l0);
				while (cur) {
					const line0 = (cur.line ?? 1) - 1;
					const v = aliasMap[line0];
					if (v) return v;
					const pid = cur._parentId;
					cur = pid ? byId.get(pid) : null;
				}
				return null;
			};
			// Variant that also returns the source ancestor line that provided the alias
			const nearestUpWithSource = (
				l0: number,
				aliasMap: (string | null)[]
			): { alias: string | null; source: number | null } => {
				let cur = byLine.get(l0);
				while (cur) {
					const line0 = (cur.line ?? 1) - 1;
					const v = aliasMap[line0];
					if (v) return { alias: v, source: line0 };
					const pid = cur._parentId;
					cur = pid ? byId.get(pid) : null;
				}
				return { alias: null, source: null };
			};

			const toSetExplicit = new Map<number, string>(); // line -> alias to set explicitly
			for (const d of descendants) {
				if (!isUncheckedTaskLine(lines[d] || "")) continue;

				// Previous effective assignment (explicit or inherited)
				const explicitD = aliasBefore[d];
				const prevEff = explicitD ?? nearestUp(d, aliasBefore);
				// New effective assignment after the change (using updated aliasAfter parent)
				const newEff = aliasAfter[d] ?? nearestUp(d, aliasAfter);

				if (prevEff !== newEff) {
					if (prevEff) {
						toSetExplicit.set(d, prevEff);
						aliasAfter[d] = prevEff; // Reflect planned explicit addition for downstream inheritance
					}
				} else {
					// If effective assignment stayed same but was previously inferred from the changed ancestor,
					// convert it to an explicit assignment to preserve intent.
					if (!explicitD && prevEff) {
						const beforeSrc = nearestUpWithSource(d, aliasBefore).source;
						if (beforeSrc === parentLine0) {
							toSetExplicit.set(d, prevEff);
							aliasAfter[d] = prevEff;
						}
					}
				}
			}

			// Pass 2: remove redundant explicits that now match inherited value
			const toRemoveExplicit = new Set<number>();
			for (const d of descendants) {
				if (!isUncheckedTaskLine(lines[d] || "")) continue;

				const explicitD = aliasAfter[d];
				if (!explicitD) continue;

				// Exclude self to compute inherited value
				const saved = aliasAfter[d];
				aliasAfter[d] = null;
				const inherited = nearestUp(d, aliasAfter);
				aliasAfter[d] = saved;

				// If an explicit equals inherited and wasn't just added to preserve a change, remove it
				if (inherited && inherited === explicitD && !toSetExplicit.has(d)) {
					toRemoveExplicit.add(d);
				}
			}

			// Apply changes to file content lines
			const team = resolveTeamForPath(filePath, (this.settings as any)?.teams ?? []);
			let changed = false;

			for (const [lineNo, alias] of toSetExplicit.entries()) {
				const orig = lines[lineNo] ?? "";
				const mark = this.buildAssigneeMarkForAlias(alias, "active", team);
				let upd = normalizeTaskLine(orig, { newAssigneeMark: mark });
				if (/<\/mark>\s*$/.test(upd)) upd = upd.replace(/\s*$/, " ");
				if (upd !== orig) {
					lines[lineNo] = upd;
					changed = true;
				}
			}

			for (const lineNo of toRemoveExplicit) {
				const orig = lines[lineNo] ?? "";
				let upd = normalizeTaskLine(orig, { newAssigneeMark: null });
				if (/<\/mark>\s*$/.test(upd)) upd = upd.replace(/\s*$/, " ");
				if (upd !== orig) {
					lines[lineNo] = upd;
					changed = true;
				}
			}

			if (changed) {
				await this.app.vault.modify(af, lines.join("\n"));
				// Keep TaskIndex fresh after cascading edits
				await this.taskIndex.updateFile(af);
			}
		} catch (err) {
			void err;
		}
	}

	public async detectAndUpdateTeams(): Promise<number> {
		try {
			const files = this.app.vault.getMarkdownFiles();
			const teamRootByName = new Map<string, string>();

			for (const f of files) {
				const base = f.basename;
				const m = /^(.*)\s+(Initiatives|Priorities)$/.exec(base);
				if (!m) continue;

				const teamName = m[1].trim();
				const segments = f.path.split("/");
				const idx = segments.findIndex((seg) => seg === teamName);

				// Valid team if any folder in the path matches the team name exactly
				if (idx !== -1) {
					const rootPath = segments.slice(0, idx + 1).join("/");
					const prev = teamRootByName.get(teamName);
					// Prefer the shortest root if multiple are found
					if (!prev || rootPath.length < prev.length) {
						teamRootByName.set(teamName, rootPath);
					}
				}
			}

			// Remove parent directories that only serve as containers (keep only deepest team roots)
			{
				const entries = Array.from(teamRootByName.entries());
				for (const [nameA, rootA] of entries) {
					for (const [, rootB] of entries) {
						if (rootA !== rootB && rootB.startsWith(rootA + "/")) {
							// If another team root is nested under this root, drop the parent/rootA
							teamRootByName.delete(nameA);
							break;
						}
					}
				}
			}

			// Build detected teams with empty member maps
			const detectedTeams = new Map<
				string,
				{ rootPath: string; members: Map<string, { name: string; type: "member" | "external" | "team" }> }
			>();
			for (const [name, rootPath] of teamRootByName.entries()) {
				detectedTeams.set(name, { rootPath, members: new Map() });
			}


			// Scan all files within each team's root folder to detect members
			const allFiles = this.app.vault.getAllLoadedFiles();
			for (const [, info] of detectedTeams.entries()) {
				const root = info.rootPath;
				for (const af of allFiles) {
					if (af instanceof TFile && af.extension === "md" && (af.path === root || af.path.startsWith(root + "/"))) {
						const content = await this.app.vault.cachedRead(af);
						const re = /\b(?:active|inactive)-([a-z0-9-]+)\b/gi;
						let m: RegExpExecArray | null;
						while ((m = re.exec(content)) !== null) {
							const alias = m[1];
							// Exclude special assignment "active-team"/"inactive-team" — not a real member
							if (alias.toLowerCase() === "team") continue;

							const name = aliasToName(alias);
							const lower = alias.toLowerCase();
							const isExternal = lower.endsWith("-ext");
							const isTeam = lower.endsWith("-team");
							if (!info.members.has(alias)) {
								info.members.set(alias, {
									name,
									type: isExternal ? "external" : isTeam ? "team" : "member",
								});
							}
						}
					}
				}
			}

			// Merge with existing settings:
			// - Keep existing teams that were not detected (user-added)
			// - For detected teams, REPLACE members with the freshly detected set (so removals are reflected)
			const existing = (this.settings as any).teams ?? [];
			const mergedMap = new Map<
				string,
				{ rootPath: string; members: Map<string, { name: string; type: "member" | "external" | "team" }> }
			>();

			// Seed with detected teams (authoritative member sets)
			for (const [name, info] of detectedTeams.entries()) {
				mergedMap.set(name, { rootPath: info.rootPath, members: new Map(info.members) });
			}

			// Fold in existing teams (but drop container parents without marker files)
			const hasTeamMarkers = (name: string, rootPath: string): boolean => {
				const a = `${name} Initiatives`;
				const b = `${name} Priorities`;
				const normalizedRoot = (rootPath || "").replace(/\/+$/g, "");
				for (const f of files) {
					if (
						(f.basename === a || f.basename === b) &&
						(f.path === normalizedRoot || f.path.startsWith(normalizedRoot + "/"))
					) {
						return true;
					}
				}
				return false;
			};

			for (const t of existing) {
				if (!mergedMap.has(t.name)) {
					// If this existing team is simply a parent/container of any detected team
					// and does NOT have its own marker files, exclude it.
					const normalizedRoot = (t.rootPath || "").replace(/\/+$/g, "");
					const isParentOfDetected = Array.from(mergedMap.values()).some(
						(v) => v.rootPath !== normalizedRoot && v.rootPath.startsWith(normalizedRoot + "/")
					);
					if (isParentOfDetected && !hasTeamMarkers(t.name, normalizedRoot)) {
						// Skip adding this container parent
						continue;
					}

					// Preserve user-created teams not found by detection
					const mm = new Map<string, { name: string; type: "member" | "external" | "team" }>();
					// @ts-ignore backward compatibility
					const existingMembers = (t as any).members as
						| { alias: string; name: string; type?: "member" | "external" | "team" }[]
						| undefined;
					if (existingMembers) {
						for (const m of existingMembers) {
							const lower = m.alias?.toLowerCase?.() ?? "";
							const type =
								(m as any).type ??
								(lower.endsWith("-ext") ? "external" : lower.endsWith("-team") ? "team" : "member");
							mm.set(m.alias, { name: m.name, type });
						}
					}
					mergedMap.set(t.name, { rootPath: t.rootPath, members: mm });
				} else {
					// Detected team: keep detected members, but prefer any customized rootPath from existing
					const entry = mergedMap.get(t.name);
					if (entry && t.rootPath && t.rootPath !== entry.rootPath) {
						entry.rootPath = t.rootPath;
					}
					// Do NOT merge members here; detected set remains the source of truth
				}
			}

			(this.settings as any).teams = Array.from(mergedMap.entries())
				.map(([name, v]) => ({
					name,
					rootPath: v.rootPath,
					members: Array.from(v.members.entries())
						.map(([alias, meta]) => ({ alias, name: meta.name, type: meta.type }))
						.sort((a, b) => {
							const typeFrom = (m: { alias: string; type?: string }) =>
								(m as any).type ??
								(m.alias.toLowerCase().endsWith("-ext")
									? "external"
									: m.alias.toLowerCase().endsWith("-team")
									? "team"
									: "member");
							const rank = (t: string) => (t === "member" ? 0 : t === "team" ? 1 : 2);
							const ra = rank(typeFrom(a) as string);
							const rb = rank(typeFrom(b) as string);
							if (ra !== rb) return ra - rb;
							return a.name.localeCompare(b.name);
						}),
				}))
				.sort((a, b) => a.name.localeCompare(b.name));

			await this.saveSettings();
			return ((this.settings as any).teams as any[]).length;
		} catch {
			// Silent on startup
			return ((this.settings as any)?.teams?.length ?? 0);
		}
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// @ts-ignore - Suppress type error for custom event (Obsidian typings don't support arbitrary events)
		this.app.workspace.trigger("agile-settings-changed");
	}

	async activateView() {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_AGILE_DASHBOARD);

		if (leaves.length > 0) {
			// If already open, reveal and activate the existing one (wherever it is)
			leaf = leaves[0];
			workspace.revealLeaf(leaf);
			workspace.setActiveLeaf(leaf); // Ensure it's focused
		} else {
			// Create a new leaf in the main central area (as a tab)
			leaf = workspace.getLeaf(true);
			await leaf.setViewState({
				type: VIEW_TYPE_AGILE_DASHBOARD,
				active: true,
			});
			workspace.revealLeaf(leaf);
		}
	}
}

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.setText("Woah!");
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
