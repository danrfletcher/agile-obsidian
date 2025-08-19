import {
	App,
	Editor,
	MarkdownView,
	Modal,
	Plugin,
	TFile,
	WorkspaceLeaf,
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
} from "./utils/commands/commandUtils";

export default class AgileObsidianPlugin extends Plugin {
	settings: AgileObsidianSettings;
	taskIndex: TaskIndex;
	private checkboxStyleEl?: HTMLStyleElement;
	private dynamicCommandIds: Set<string> = new Set();

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
		}
	}

	

	private unregisterDynamicCommands(): void {
		try {
			// @ts-ignore - commands API not in public types
			const cmds = this.app.commands;
			for (const id of this.dynamicCommandIds) {
				try {
					// @ts-ignore
					cmds.removeCommand(id);
				} catch {}
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
		const title =
			isMe
				? `/Assign: to me (${variant})`
				: `/Assign: to ${memberName} (${variant})`;

		const bg = variant === "active" ? "#BBFABBA6" : "#CACFD9A6";
		const newMark = `<mark class="${variant}-${memberAlias}" style="background: ${bg};"><strong>👋 ${memberName}</strong></mark>`;
		// Any existing assignment mark (👋) – irrespective of alias – should be overwritten
		const reExistingAssignment =
			/(?:\s+)?<mark\s+class="(?:active|inactive)-[a-z0-9-]+"[^>]*>\s*<strong>👋[\s\S]*?<\/strong>\s*<\/mark>/i;

		// @ts-ignore - types for id not strictly enforced
		this.addCommand({
			id,
			name: title,
			editorCheckCallback: (checking: boolean, editor: Editor, view: MarkdownView) => {
				const filePath = view?.file?.path ?? null;
				if (!filePath) return false;
				const team = resolveTeamForPath(filePath, (this.settings as any)?.teams ?? []);
				if (!team || team.name !== teamName) return false;

				const pos = editor.getCursor();
				const line = editor.getLine(pos.line);
				if (!isUncheckedTaskLine(line)) return false;

				if (checking) return true;

				let updated = line.replace(/\s+$/, "");
				if (reExistingAssignment.test(updated)) {
					// Replace existing assignment in place, normalize to single leading space
					updated = updated.replace(reExistingAssignment, ` ${newMark}`);
				} else {
					const spacer = updated.endsWith(" ") ? "" : " ";
					updated = `${updated}${spacer}${newMark}`;
				}
				updated = updated.replace(/\s{2,}/g, " ");

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

		const newMark = `→ <mark class="${variant}-${targetAlias}" style="background: ${bg};"><strong><a href="">${emoji} ${targetName}</a></strong></mark>`;
		// Any existing delegation (arrow + mark containing an anchor) – irrespective of alias – should be overwritten
		const reExistingDelegation =
			/(?:\s*→\s*)?<mark\s+class="(?:active|inactive)-[a-z0-9-]+"[^>]*>[\s\S]*?<a\b[^>]*>[\s\S]*?<\/a>[\s\S]*?<\/mark>/i;

		// @ts-ignore - types for id not strictly enforced
		this.addCommand({
			id,
			name: title,
			editorCheckCallback: (checking: boolean, editor: Editor, view: MarkdownView) => {
				const filePath = view?.file?.path ?? null;
				if (!filePath) return false;
				const team = resolveTeamForPath(filePath, (this.settings as any)?.teams ?? []);
				if (!team || team.name !== teamName) return false;

				const pos = editor.getCursor();
				const line = editor.getLine(pos.line);
				if (!isUncheckedTaskLine(line)) return false;

				// Only after an assignment to a team member exists
				if (!hasAnyTeamMemberAssignment(line, team)) return false;

				if (checking) return true;

				let updated = line.replace(/\s+$/, "");
				if (reExistingDelegation.test(updated)) {
					// Replace existing delegation (including optional arrow) with a single spaced arrow + mark
					updated = updated.replace(reExistingDelegation, ` ${newMark}`);
				} else {
					const spacer = updated.endsWith(" ") ? "" : " ";
					updated = `${updated}${spacer}${newMark}`;
				}
				updated = updated.replace(/\s{2,}/g, " ");

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
		this.registerDomEvent(document, "click", (evt: MouseEvent) => {
			console.log("click", evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(
			window.setInterval(() => console.log("setInterval"), 5 * 60 * 1000)
		);

		this.registerEvent(
			this.app.vault.on("modify", async (file) => {
				if (file instanceof TFile && file.extension === "md") {
					await this.taskIndex.updateFile(file);
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
		}
	}

	public async applyCheckboxStylesSetting(): Promise<void> {
		if ((this.settings as any)?.useBundledCheckboxes) {
			await this.injectCheckboxStyles();
		} else {
			this.removeCheckboxStyles();
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
			for (const [teamName, info] of detectedTeams.entries()) {
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
					const entry = mergedMap.get(t.name)!;
					if (t.rootPath && t.rootPath !== entry.rootPath) {
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
