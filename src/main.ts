import { Plugin, TFile, MarkdownView } from "obsidian";
import { AgileSettingTab } from "./settings/settings.ui";
import { DEFAULT_SETTINGS } from "./settings/settings.store";
import type {
	AgileObsidianSettings,
	TeamInfo,
	MemberInfo,
} from "./settings/settings.types";
import { hydrateTeamsFromVault } from "./features/orgStructure/teamDetection";
import {
	createOrganizationFromTeam,
	addTeamsToExistingOrganization,
	createSubteams,
} from "./features/orgStructure/organizations";
import { createTeamResources } from "./features/orgStructure/teamCreation";
import {
	slugifyName,
	resolveTeamForPath,
	isUncheckedTaskLine,
} from "./utils/commands/commandUtils";
import { injectCheckboxStyles, removeCheckboxStyles } from "./styles/injection";
import { TaskIndex } from "./features/taskIndex/TaskIndex";
import { registerMarkClickHandlers } from "./ui/markContextMenu";
import { findTargetLineFromClick } from "./utils/fs/editorUtils";
import { normalizeTaskLine } from "./utils/format/taskFormatter";
import {
	getExplicitAssigneeAliasFromText,
	buildAssigneeMarkForAlias,
} from "./features/taskAssignment/assigneeMarks";
import { applyAssigneeChangeWithCascade } from "./features/taskAssignment/assignmentCascade";
import { renderDelegateMark } from "./features/taskAssignment/markTemplates";
import { DelegateSlashSuggest } from "./utils/commands/slashDelegate";
import { registerTemplatingCommands } from "./features/templating/templatingCommands";

export default class AgileObsidianPlugin extends Plugin {
	settings: AgileObsidianSettings;

	async onload() {
		await this.loadSettings();
		await this.applyCheckboxStylesSetting();

		// Settings Tab (thin UI shell)
		this.addSettingTab(
			new AgileSettingTab(
				this.app,
				this,
				this.settings,
				{
					detectAndUpdateTeams: async () => {
						await hydrateTeamsFromVault(
							this.app.vault,
							this.settings as unknown as {
								teamsFolder: string;
								teams?: TeamInfo[]; // type name here just needs compatible shape; settings.types.TeamInfo matches
								[k: string]: any;
							}
						);
						await this.saveSettings();
					},
					saveSettings: async () => {
						await this.saveSettings();
					},
					createTeam: async (
						teamName,
						parentPath,
						teamSlug,
						_code
					) => {
						const { info } = await createTeamResources(
							this.app,
							teamName,
							parentPath,
							teamSlug
						);
						const idx = this.settings.teams.findIndex(
							(t) =>
								t.name === info.name &&
								t.rootPath === info.rootPath
						);
						// Normalize to TeamInfo: ensure required members field exists to satisfy type-safety
						// If omitted, downstream code that iterates team.members could throw at runtime.
						const normalized: TeamInfo = {
							name: info.name,
							rootPath: info.rootPath,
							slug: (info as any).slug,
							members: Array.isArray((info as any).members)
								? ((info as any).members as MemberInfo[])
								: [],
						};
						if (idx === -1) this.settings.teams.push(normalized);
						else this.settings.teams[idx] = normalized;
						await this.saveSettings();
					},
					createOrganizationFromTeam: async (
						team,
						orgName,
						suffixes
					) => {
						const teamInfo: TeamInfo = {
							...(team as any),
							members: [] as MemberInfo[],
						};
						await createOrganizationFromTeam({
							app: this.app,
							orgName,
							orgSlug: slugifyName(orgName),
							team: teamInfo,
							suffixes,
						});
					},
					addTeamsToExistingOrganization: async (
						org,
						orgName,
						suffixes
					) => {
						const orgInfo: TeamInfo = {
							...(org as any),
							members: [] as MemberInfo[],
						};
						await addTeamsToExistingOrganization(
							this.app,
							orgInfo,
							orgName,
							suffixes
						);
					},
					createSubteams: async (parentTeam, suffixes) => {
						await createSubteams(
							this.app,
							parentTeam as TeamInfo,
							suffixes
						);
					},
				},
				() => this.saveSettings(),
				() => this.applyCheckboxStylesSetting()
			)
		);
		await this.registerTaskFeatures();

		registerTemplatingCommands(this);
	}

	onunload() {
		removeCheckboxStyles(this.manifest.id);
	}

	async loadSettings() {
		const data = await this.loadData();
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			data
		) as AgileObsidianSettings;
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// Toggle bundled checkbox CSS (wired from settings UI)
	async applyCheckboxStylesSetting() {
		if (this.settings.useBundledCheckboxes) {
			injectCheckboxStyles(this.manifest.id);
		} else {
			removeCheckboxStyles(this.manifest.id);
		}
	}
	// Wire up dynamic assignment/delegation features, mark click handlers, and TaskIndex
	private async registerTaskFeatures() {
		const index = TaskIndex.getInstance(this.app);
		await index.buildIndex();

		// Keep TaskIndex fresh as files change
		this.registerEvent(
			this.app.vault.on("modify", async (file) => {
				try {
					if (file instanceof TFile && file.extension === "md") {
						await index.updateFile(file);
					}
				} catch {
					/* no-op */
				}
			})
		);
		this.registerEvent(
			this.app.vault.on("rename", async (file, oldPath) => {
				try {
					if (oldPath) index.removeFile(oldPath);
					if (file instanceof TFile && file.extension === "md") {
						await index.updateFile(file);
					}
				} catch {
					/* no-op */
				}
			})
		);
		this.registerEvent(
			this.app.vault.on("delete", async (file) => {
				try {
					index.removeFile((file as any)?.path ?? "");
				} catch {
					/* no-op */
				}
			})
		);

		// Register click handlers for <mark> context menu
		const disposer = registerMarkClickHandlers(
			this.app,
			() => this.settings,
			{
				resolveTeamForPath,
				isUncheckedTaskLine,
				normalizeTaskLine,
				findTargetLineFromClick,
				getExplicitAssigneeAliasFromText,
				applyAssigneeChangeWithCascade: async (
					filePath,
					editor,
					lineNo,
					oldAlias,
					newAlias,
					variant,
					team
				) => {
					const deps = {
						app: this.app,
						taskIndex: index,
						normalizeTaskLine,
						isUncheckedTaskLine,
						getExplicitAssigneeAliasFromText,
						buildAssigneeMarkForAlias,
					};
					await applyAssigneeChangeWithCascade(
						filePath,
						editor,
						lineNo,
						oldAlias,
						newAlias,
						variant,
						team,
						deps as any
					);
				},
			}
		);
		this.register(() => disposer());

		// Register slash command for delegation (/delegate ...)
		this.registerEditorSuggest(
			new DelegateSlashSuggest(this.app, () => this.settings, {
				normalizeTaskLine,
				renderDelegateMark,
				resolveTeamForPath,
				isUncheckedTaskLine,
			})
		);

		// Dynamic commands for assign/delegate
		this.buildDynamicCommands();
	}

	private buildDynamicCommands() {
		const teams = this.settings.teams ?? [];

		// Build a unique alias->name map from all teams
		const uniq = new Map<string, { alias: string; name: string }>();
		for (const t of teams) {
			for (const m of t.members ?? []) {
				const alias = (m.alias || "").toLowerCase();
				if (!alias) continue;
				uniq.set(alias, { alias, name: m.name || alias });
			}
		}
		// Ensure 'team' (Everyone) exists
		if (!uniq.has("team")) {
			uniq.set("team", { alias: "team", name: "Everyone" });
		}

		// Helpers
		const toTitleCase = (s: string) =>
			s.replace(
				/\w\S*/g,
				(w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
			);

		const cleanBaseName = (raw: string) => {
			// Remove the 6-char code segment (with optional leading space), not capturing scope suffix
			// Examples:
			//  "nueral-s-6hjk8k-team" -> "nueral-s-team"
			//  "anthony-cooke-7hj8kl-ext" -> "anthony-cooke-ext"
			//  "boffin-mcboffster-6gh7jk-int" -> "boffin-mcboffster-int"
			let s = raw.replace(
				/(?:\s|-|_)[0-9][a-z0-9]{5}(?=(?:\b|[-_]))/i,
				""
			);
			// Normalize separators to spaces
			s = s.replace(/[-_]+/g, " ");
			// Collapse spaces
			s = s.replace(/\s+/g, " ").trim();
			return s;
		};

		const makeLabelFromAliasOrName = (alias: string, name?: string) => {
			// Prefer provided name; otherwise derive from alias
			const base = cleanBaseName(name?.trim() || alias);
			// Now drop any trailing scope tokens like "ext", "int", or "team" that might remain
			const scopeTail = /\b(?:ext|int|team)\b$/i;
			const cleaned = base
				.replace(scopeTail, "")
				.replace(/\s+/g, " ")
				.trim();
			return toTitleCase(cleaned);
		};

		// Helper to resolve the active team from current file
		const getActiveTeam = (view: MarkdownView) => {
			const filePath = (view as any)?.file?.path ?? null;
			if (!filePath) return null;
			return resolveTeamForPath(filePath, teams as any[]);
		};

		// Assign commands (both variants); exclude -ext/-team/-int except special 'team'
		const assignables = Array.from(uniq.values()).filter(
			(x) =>
				x.alias === "team" ||
				(!x.alias.endsWith("-ext") &&
					!x.alias.endsWith("-team") &&
					!x.alias.endsWith("-int"))
		);

		for (const { alias } of assignables) {
			for (const variant of ["active", "inactive"] as const) {
				const displaySource =
					alias === "team"
						? "Everyone"
						: uniq.get(alias)?.name ?? alias;
				const label =
					alias === "team"
						? "Everyone"
						: makeLabelFromAliasOrName(alias, displaySource);

				this.addCommand({
					id: `assign-${alias}-${variant}`,
					name: `Assign: ${label} (${variant})`,
					editorCallback: async (editor, view) => {
						try {
							if (!(view instanceof MarkdownView)) return;
							const team = getActiveTeam(view);
							if (!team) return;

							const filePath = (view as any)?.file?.path ?? null;
							if (!filePath) return;

							const lineNo = editor.getCursor().line;
							const line = editor.getLine(lineNo);
							if (!isUncheckedTaskLine(line)) return;

							const oldAlias =
								getExplicitAssigneeAliasFromText(line);
							const deps = {
								app: this.app,
								taskIndex: TaskIndex.getInstance(this.app),
								normalizeTaskLine,
								isUncheckedTaskLine,
								getExplicitAssigneeAliasFromText,
								buildAssigneeMarkForAlias,
							};
							await applyAssigneeChangeWithCascade(
								filePath,
								editor as any,
								lineNo,
								oldAlias,
								alias,
								variant,
								team,
								deps as any
							);
						} catch {
							/* no-op */
						}
					},
				});
			}
		}

		// Delegate commands
		const vals = Array.from(uniq.values());

		// TEAM-scope delegates (aliases ending with -team but not the special "team")
		const internalTeams = vals.filter(
			(x) => x.alias.endsWith("-team") && x.alias !== "team"
		);
		for (const { alias } of internalTeams) {
			const displaySource = uniq.get(alias)?.name ?? alias;
			const label = makeLabelFromAliasOrName(alias, displaySource); // e.g., "Nueral S"
			this.addCommand({
				id: `delegate-team-${alias}`,
				name: `Delegate to Team: ${label}`,
				editorCallback: (editor, view) => {
					try {
						if (!(view instanceof MarkdownView)) return;
						const team = getActiveTeam(view);
						if (!team) return;

						const filePath = (view as any)?.file?.path ?? null;
						if (!filePath) return;

						const lineNo = editor.getCursor().line;
						const before = editor.getLine(lineNo);
						if (!isUncheckedTaskLine(before)) return;
						// Disallow delegation when Everyone is assigned
						if (
							/\bclass="(?:active|inactive)-team"\b/i.test(before)
						)
							return;

						const mark = renderDelegateMark(
							alias,
							label,
							"active",
							"team"
						);
						let updated = normalizeTaskLine(before, {
							newDelegateMark: mark,
						});
						if (/<\/mark>\s*$/.test(updated))
							updated = updated.replace(/\s*$/, " ");
						editor.replaceRange(
							updated,
							{ line: lineNo, ch: 0 },
							{ line: lineNo, ch: before.length }
						);
					} catch {
						/* no-op */
					}
				},
			});
		}

		// INTERNAL delegates (-int)
		const internalMembers = vals.filter((x) => x.alias.endsWith("-int"));
		for (const { alias } of internalMembers) {
			const displaySource = uniq.get(alias)?.name ?? alias;
			const label = makeLabelFromAliasOrName(alias, displaySource); // e.g., "Boffin Mcboffster"
			this.addCommand({
				id: `delegate-internal-${alias}`,
				name: `Delegate to Internal: ${label}`,
				editorCallback: (editor, view) => {
					try {
						if (!(view instanceof MarkdownView)) return;

						const filePath = (view as any)?.file?.path ?? null;
						if (!filePath) return;

						const lineNo = editor.getCursor().line;
						const before = editor.getLine(lineNo);
						if (!isUncheckedTaskLine(before)) return;
						// Disallow delegation when Everyone is assigned
						if (
							/\bclass="(?:active|inactive)-team"\b/i.test(before)
						)
							return;

						const mark = renderDelegateMark(
							alias,
							label,
							"active",
							"internal"
						);
						let updated = normalizeTaskLine(before, {
							newDelegateMark: mark,
						});
						if (/<\/mark>\s*$/.test(updated))
							updated = updated.replace(/\s*$/, " ");
						editor.replaceRange(
							updated,
							{ line: lineNo, ch: 0 },
							{ line: lineNo, ch: before.length }
						);
					} catch {
						/* no-op */
					}
				},
			});
		}

		// EXTERNAL delegates (-ext)
		const externals = vals.filter((x) => x.alias.endsWith("-ext"));
		for (const { alias } of externals) {
			const displaySource = uniq.get(alias)?.name ?? alias;
			const label = makeLabelFromAliasOrName(alias, displaySource); // e.g., "Anthony Cooke"
			this.addCommand({
				id: `delegate-external-${alias}`,
				name: `Delegate to External: ${label}`,
				editorCallback: (editor, view) => {
					try {
						if (!(view instanceof MarkdownView)) return;

						const filePath = (view as any)?.file?.path ?? null;
						if (!filePath) return;

						const lineNo = editor.getCursor().line;
						const before = editor.getLine(lineNo);
						if (!isUncheckedTaskLine(before)) return;
						// Disallow delegation when Everyone is assigned
						if (
							/\bclass="(?:active|inactive)-team"\b/i.test(before)
						)
							return;

						const mark = renderDelegateMark(
							alias,
							label,
							"active",
							"external"
						);
						let updated = normalizeTaskLine(before, {
							newDelegateMark: mark,
						});
						if (/<\/mark>\s*$/.test(updated))
							updated = updated.replace(/\s*$/, " ");
						editor.replaceRange(
							updated,
							{ line: lineNo, ch: 0 },
							{ line: lineNo, ch: before.length }
						);
					} catch {
						/* no-op */
					}
				},
			});
		}
	}
}
