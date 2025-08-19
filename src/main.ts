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

export default class AgileObsidianPlugin extends Plugin {
	settings: AgileObsidianSettings;
	taskIndex: TaskIndex;
	private checkboxStyleEl?: HTMLStyleElement;

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
	}

	onunload() {
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
		if (this.settings?.useBundledCheckboxes) {
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

			// Build detected teams with empty member maps
			const detectedTeams = new Map<
				string,
				{ rootPath: string; members: Map<string, { name: string; type: "member" | "external" }> }
			>();
			for (const [name, rootPath] of teamRootByName.entries()) {
				detectedTeams.set(name, { rootPath, members: new Map() });
			}

			// Helper: convert alias to display name (handles double hyphen in alias as name hyphen)
			const aliasToName = (alias: string): string => {
				let normalized = alias;
				const lower = alias.toLowerCase();
				if (lower.endsWith("-ext")) normalized = alias.slice(0, -4);
				else if (lower.endsWith("-team")) normalized = alias.slice(0, -5);
				else if (lower.endsWith("-int")) normalized = alias.slice(0, -4);
				const m = /^([a-z0-9-]+)-([0-9][a-z0-9]{5})$/i.exec(normalized);
				const base = (m ? m[1] : normalized).toLowerCase();

				// Parse into tokens, where '-' separates tokens, and '--' inserts a literal hyphen
				const tokens: string[] = [""];
				for (let i = 0; i < base.length; i++) {
					const ch = base[i];
					if (ch === "-") {
						if (i + 1 < base.length && base[i + 1] === "-") {
							// literal hyphen inside the current token
							tokens[tokens.length - 1] += "-";
							i++; // skip the second '-'
						} else {
							// token separator
							tokens.push("");
						}
					} else {
						tokens[tokens.length - 1] += ch;
					}
				}
				const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
				return tokens.filter(Boolean).map(cap).join(" ");
			};

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
			const existing = this.settings.teams ?? [];
			const mergedMap = new Map<
				string,
				{ rootPath: string; members: Map<string, { name: string; type: "member" | "external" | "team" }> }
			>();

			// Seed with detected teams (authoritative member sets)
			for (const [name, info] of detectedTeams.entries()) {
				mergedMap.set(name, { rootPath: info.rootPath, members: new Map(info.members) });
			}

			// Fold in existing teams
			for (const t of existing) {
				if (!mergedMap.has(t.name)) {
					// Preserve user-created teams not found by detection
					const mm = new Map<string, { name: string; type: "member" | "external" | "team" }>();
					// @ts-ignore backward compatibility
					const existingMembers = (t as any).members as { alias: string; name: string; type?: "member" | "external" | "team" }[] | undefined;
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

			this.settings.teams = Array.from(mergedMap.entries())
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
			return this.settings.teams.length;
		} catch {
			// Silent on startup
			return this.settings?.teams?.length ?? 0;
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
