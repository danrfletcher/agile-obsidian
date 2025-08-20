import {
	App,
	PluginSettingTab,
	Setting,
	TFolder,
	Modal,
	Notice,
} from "obsidian";
import AgileObsidian from "./main";

export interface MemberInfo {
	alias: string;
	name: string;
	type?: "member" | "external" | "team" | "internal-team-member";
}

class AddMemberModal extends Modal {
	private onSubmit: (
		memberName: string,
		memberAlias: string
	) => void | Promise<void>;
	private teamName: string;
	private allTeams: string[];
	private existingMembers: MemberInfo[];
	private internalTeamCodes: Map<string, string>;

	constructor(
		app: App,
		teamName: string,
		allTeams: string[],
		existingMembers: MemberInfo[],
		internalTeamCodes: Map<string, string>,
		onSubmit: (
			memberName: string,
			memberAlias: string
		) => void | Promise<void>
	) {
		super(app);
		this.onSubmit = onSubmit;
		this.teamName = teamName;
		this.allTeams = allTeams;
		this.existingMembers = existingMembers;
		this.internalTeamCodes = internalTeamCodes;
	}

	private generateCode(): string {
		const first = Math.floor(Math.random() * 10).toString(); // 0-9
		const rest = Array.from({ length: 5 })
			.map(() => Math.floor(Math.random() * 36).toString(36))
			.join("");
		return (first + rest).toLowerCase();
	}

	private nameToAlias(
		name: string,
		code: string,
		isExternal: boolean
	): string {
		// Lowercase, spaces -> '-', existing hyphens -> '--', strip invalid
		let base = (name || "").trim().toLowerCase();
		base = base
			.replace(/-/g, "--")
			.replace(/\s+/g, "-")
			.replace(/[^a-z0-9-]/g, "");
		return `${base}-${code}${isExternal ? "-ext" : ""}`;
	}

	private teamAlias(name: string, code: string): string {
		// Same slug rules as nameToAlias but with '-team' suffix
		let base = (name || "").trim().toLowerCase();
		base = base
			.replace(/-/g, "--")
			.replace(/\s+/g, "-")
			.replace(/[^a-z0-9-]/g, "");
		return `${base}-${code}-team`;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		const code = this.generateCode();

		contentEl.createEl("h3", { text: `Add Member to ${this.teamName}` });

		// Member type select (above name)
		const typeWrapper = contentEl.createEl("div", {
			attr: { style: "margin-bottom: 8px;" },
		});
		typeWrapper.createEl("label", {
			text: "Member type",
			attr: { style: "display:block; margin-bottom:4px;" },
		});
		const typeSelect = typeWrapper.createEl("select", {
			attr: { style: "width: 100%;" },
		}) as HTMLSelectElement;
		const optMember = document.createElement("option");
		optMember.value = "member";
		optMember.text = "Team Member";
		typeSelect.appendChild(optMember);
		const optExternal = document.createElement("option");
		optExternal.value = "external";
		optExternal.text = "External Delegate";
		typeSelect.appendChild(optExternal);
		const optInternalTeam = document.createElement("option");
		optInternalTeam.value = "team";
		optInternalTeam.text = "Internal Team";
		typeSelect.appendChild(optInternalTeam);

		const optExisting = document.createElement("option");
		optExisting.value = "existing";
		optExisting.text = "Existing Member";
		typeSelect.appendChild(optExisting);

		typeSelect.value = "member";
		let isExternal = false;
		let isInternal = false;
		let isExisting = false;

		// Member name input
		const nameWrapper = contentEl.createEl("div", {
			attr: { style: "margin-bottom: 12px;" },
		});
		nameWrapper.createEl("label", {
			text: "Member name",
			attr: { style: "display:block; margin-bottom:4px;" },
		});
		const nameInput = nameWrapper.createEl("input", {
			type: "text",
			attr: { placeholder: "e.g., Dan Fletcher", style: "width: 100%;" },
		}) as HTMLInputElement;

		// Internal team select (hidden by default)
		const teamWrapper = contentEl.createEl("div", {
			attr: { style: "margin-bottom: 12px; display: none;" },
		});
		teamWrapper.createEl("label", {
			text: "Select team",
			attr: { style: "display:block; margin-bottom:4px;" },
		});
		const teamSelect = teamWrapper.createEl("select", {
			attr: { style: "width: 100%;" },
		}) as HTMLSelectElement;
		for (const tn of this.allTeams) {
			const opt = document.createElement("option");
			opt.value = tn;
			opt.text = tn;
			teamSelect.appendChild(opt);
		}

		// Existing member select (hidden by default)
		const existingWrapper = contentEl.createEl("div", {
			attr: { style: "margin-bottom: 12px; display: none;" },
		});
		existingWrapper.createEl("label", {
			text: "Select existing member",
			attr: { style: "display:block; margin-bottom:4px;" },
		});
		const existingSelect = existingWrapper.createEl("select", {
			attr: { style: "width: 100%;" },
		}) as HTMLSelectElement;
		for (const m of this.existingMembers || []) {
			const opt = document.createElement("option");
			opt.value = m.alias;
			opt.text = `${m.name} (${m.alias})`;
			existingSelect.appendChild(opt);
		}

		// Existing member role select (hidden by default)
		const roleWrapper = contentEl.createEl("div", {
			attr: { style: "margin-bottom: 12px; display: none;" },
		});
		roleWrapper.createEl("label", {
			text: "Existing member role",
			attr: { style: "display:block; margin-bottom:4px;" },
		});
		const roleSelect = roleWrapper.createEl("select", {
			attr: { style: "width: 100%;" },
		}) as HTMLSelectElement;
		const roleMember = document.createElement("option");
		roleMember.value = "member";
		roleMember.text = "Team Member";
		roleSelect.appendChild(roleMember);
		const roleInternal = document.createElement("option");
		roleInternal.value = "internal-team-member";
		roleInternal.text = "Internal Team Member";
		roleSelect.appendChild(roleInternal);
		roleSelect.value = "member";

		// Alias preview
		const aliasPreview = contentEl.createEl("div", {
			attr: { style: "margin-top: 8px; color: var(--text-muted);" },
		});
		aliasPreview.createEl("div", { text: "Alias (auto-generated):" });
		const aliasValue = aliasPreview.createEl("code", { text: "" });

		const updateAlias = () => {
			if (isInternal) {
				const teamName = teamSelect.value || "";
				const codeToUse = this.internalTeamCodes.get(teamName) ?? code;
				aliasValue.textContent = this.teamAlias(teamName, codeToUse);
			} else if (isExisting) {
				const selectedAlias = existingSelect.value || "";
				if (!selectedAlias) {
					aliasValue.textContent = "";
					return;
				}
				if (roleSelect.value === "internal-team-member") {
					aliasValue.textContent = selectedAlias
						.toLowerCase()
						.endsWith("-int")
						? selectedAlias
						: `${selectedAlias}-int`;
				} else {
					aliasValue.textContent = selectedAlias;
				}
			} else {
				aliasValue.textContent = this.nameToAlias(
					nameInput.value,
					code,
					isExternal
				);
			}
		};

		typeSelect.addEventListener("change", () => {
			isExternal = typeSelect.value === "external";
			isInternal = typeSelect.value === "team";
			isExisting = typeSelect.value === "existing";

			// Toggle inputs
			if (isInternal) {
				nameWrapper.style.display = "none";
				teamWrapper.style.display = "";
				existingWrapper.style.display = "none";
				roleWrapper.style.display = "none";
			} else if (isExisting) {
				nameWrapper.style.display = "none";
				teamWrapper.style.display = "none";
				existingWrapper.style.display = "";
				roleWrapper.style.display = "";
			} else {
				nameWrapper.style.display = "";
				teamWrapper.style.display = "none";
				existingWrapper.style.display = "none";
				roleWrapper.style.display = "none";
			}
			updateAlias();
		});

		nameInput.addEventListener("input", updateAlias);
		teamSelect.addEventListener("change", updateAlias);
		existingSelect.addEventListener("change", updateAlias);
		roleSelect.addEventListener("change", updateAlias);
		updateAlias();

		// Buttons
		const buttons = contentEl.createEl("div", {
			attr: {
				style: "display:flex; gap: 8px; justify-content: flex-end; margin-top: 16px;",
			},
		});

		const cancelBtn = buttons.createEl("button", { text: "Cancel" });
		cancelBtn.addEventListener("click", () => this.close());

		const addBtn = buttons.createEl("button", { text: "Add Member" });
		addBtn.addEventListener("click", async () => {
			let memberName: string;
			let memberAlias: string;

			if (isInternal) {
				memberName = (teamSelect.value || "").trim();
				if (!memberName) {
					new Notice("Please select a team.");
					return;
				}
				const codeToUse =
					this.internalTeamCodes.get(memberName) ?? code;
				memberAlias = this.teamAlias(memberName, codeToUse);
			} else if (isExisting) {
				const selectedAlias = existingSelect.value || "";
				if (!selectedAlias) {
					new Notice("Please select an existing member.");
					return;
				}
				const found = (this.existingMembers || []).find(
					(m) => m.alias === selectedAlias
				);
				memberName = found?.name ?? selectedAlias;
				if (roleSelect.value === "internal-team-member") {
					memberAlias = selectedAlias.toLowerCase().endsWith("-int")
						? selectedAlias
						: `${selectedAlias}-int`;
				} else {
					memberAlias = selectedAlias;
				}
			} else {
				memberName = nameInput.value.trim();
				if (!memberName) {
					new Notice("Please enter a member name.");
					return;
				}
				memberAlias = this.nameToAlias(memberName, code, isExternal);
			}

			await this.onSubmit(memberName, memberAlias);
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export interface TeamInfo {
	name: string;
	rootPath: string;
	members: MemberInfo[];
}

class AddTeamModal extends Modal {
	private onSubmit: (
		teamName: string,
		parentPath: string
	) => void | Promise<void>;

	constructor(
		app: App,
		onSubmit: (teamName: string, parentPath: string) => void | Promise<void>
	) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h3", { text: "Add Team" });

		// Team name input
		const nameWrapper = contentEl.createEl("div", {
			attr: { style: "margin-bottom: 12px;" },
		});
		nameWrapper.createEl("label", {
			text: "Team name",
			attr: { style: "display:block; margin-bottom:4px;" },
		});
		const nameInput = nameWrapper.createEl("input", {
			type: "text",
			attr: { placeholder: "e.g., Sample Team", style: "width: 100%;" },
		}) as HTMLInputElement;

		// Parent folder select
		const folderWrapper = contentEl.createEl("div", {
			attr: { style: "margin-bottom: 12px;" },
		});
		folderWrapper.createEl("label", {
			text: "Parent folder",
			attr: { style: "display:block; margin-bottom:4px;" },
		});

		const selectEl = folderWrapper.createEl("select", {
			attr: { style: "width: 100%;" },
		}) as HTMLSelectElement;

		// Populate folders
		const all = this.app.vault.getAllLoadedFiles();
		const folders = all.filter((f) => f instanceof TFolder) as TFolder[];
		// Ensure root is present
		const paths = Array.from(
			new Set<string>(["/", ...folders.map((f) => f.path)])
		).sort((a, b) => a.localeCompare(b));

		for (const p of paths) {
			const opt = document.createElement("option");
			opt.value = p;
			opt.text = p === "/" ? "(vault root)" : p;
			selectEl.appendChild(opt);
		}

		// Buttons
		const buttons = contentEl.createEl("div", {
			attr: {
				style: "display:flex; gap: 8px; justify-content: flex-end; margin-top: 16px;",
			},
		});

		const cancelBtn = buttons.createEl("button", { text: "Cancel" });
		cancelBtn.addEventListener("click", () => this.close());

		const addBtn = buttons.createEl("button", { text: "Add Team" });
		addBtn.addEventListener("click", async () => {
			const teamName = nameInput.value.trim();
			const parentPath = selectEl.value;
			if (!teamName) {
				new Notice("Please enter a team name.");
				return;
			}
			await this.onSubmit(teamName, parentPath);
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export interface AgileObsidianSettings {
	showObjectives: boolean;
	showTasks: boolean;
	showStories: boolean;
	showEpics: boolean;
	showInitiatives: boolean;
	showResponsibilities: boolean;
	showPriorities: boolean;
	useBundledCheckboxes: boolean;
	currentUserAlias: string | null;
	teams: TeamInfo[];
}

export const DEFAULT_SETTINGS: AgileObsidianSettings = {
	showObjectives: true,
	showTasks: true,
	showStories: true,
	showEpics: true,
	showInitiatives: true,
	showResponsibilities: true,
	showPriorities: true,
	useBundledCheckboxes: true,
	currentUserAlias: null,
	teams: [],
};

/**
 * Helper: returns the saved current user alias (or null if not set).
 */
export function getCurrentUserAlias(
	settings: AgileObsidianSettings
): string | null {
	return settings.currentUserAlias ?? null;
}

/**
 * Helper: find a member's display name by alias across all teams.
 * Returns null if no match is found.
 */
export function getMemberDisplayNameByAlias(
	teams: TeamInfo[],
	alias: string
): string | null {
	if (!alias) return null;
	for (const t of teams ?? []) {
		for (const m of t.members ?? []) {
			if ((m.alias ?? "") === alias) {
				return m.name ?? alias;
			}
		}
	}
	return null;
}

/**
 * Convenience: resolve the current user's display name from settings.
 * Falls back to null if alias isn't set or member isn't found.
 */
export function getCurrentUserDisplayName(
	settings: AgileObsidianSettings
): string | null {
	const alias = getCurrentUserAlias(settings);
	if (!alias) return null;
	return getMemberDisplayNameByAlias(settings.teams ?? [], alias);
}

export class AgileSettingTab extends PluginSettingTab {
	plugin: AgileObsidian;

	constructor(app: App, plugin: AgileObsidian) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty(); // Clear existing content

		containerEl.createEl("h1", { text: "Agile Obsidian Settings" });

		// Teams (top section)
		containerEl.createEl("h3", { text: "Teams" });

		const teamsButtons = new Setting(containerEl)
			.setName("List Members & Teams")
			.setDesc("Detects teams from your vault and adds new teams.");
		teamsButtons.addButton((btn) =>
			btn
				.setButtonText("Update Teams")
				.setCta()
				.onClick(async () => {
					await this.plugin.detectAndUpdateTeams();
					renderTeamsList();
					renderCurrentUserSelector();
					new Notice(
						`Detected ${this.plugin.settings.teams.length} team(s).`
					);
				})
		);

		teamsButtons.addButton((btn) =>
			btn.setButtonText("Add Team").onClick(() => {
				new AddTeamModal(this.app, async (teamName, parentPath) => {
					try {
						await createTeamResources(teamName, parentPath);
					} catch (e) {
						new Notice(`Failed to add team: ${e}`);
					}
				}).open();
			})
		);

		// Container to display teams
		const teamsListContainer = containerEl.createEl("div");
		const identityContainer = containerEl.createEl("div", {
			attr: { style: "padding-top: 12px;" },
		});

		// Render teams helper
		const renderTeamsList = () => {
			teamsListContainer.empty();
			if (
				!this.plugin.settings.teams ||
				this.plugin.settings.teams.length === 0
			) {
				teamsListContainer.createEl("em", { text: "No teams yet." });
				return;
			}
			for (const t of this.plugin.settings.teams) {
				const row = teamsListContainer.createEl("div", {
					attr: {
						style: "display: flex; gap: 8px; align-items: center; margin: 6px 0;",
					},
				});

				// Team name
				row.createEl("strong", { text: t.name });

				// Scrollable, disabled input showing the path (click to reveal in file explorer and close settings)
				const pathInput = row.createEl("input", {
					type: "text",
					attr: {
						style: "flex: 1; min-width: 0; white-space: nowrap; overflow-x: auto; padding: 2px 6px;",
					},
				}) as HTMLInputElement;
				pathInput.value = t.rootPath;
				pathInput.readOnly = true;
				pathInput.disabled = true;
				pathInput.addEventListener("click", () => {
					const folder = this.app.vault.getAbstractFileByPath(
						t.rootPath
					);
					const explorerLeaves =
						this.app.workspace.getLeavesOfType("file-explorer");
					if (explorerLeaves.length > 0 && folder) {
						const leaf = explorerLeaves[0];
						// @ts-ignore Internal API
						leaf.view.revealInFolder(folder);
						this.app.workspace.revealLeaf(leaf);
						// @ts-ignore Close settings panel
						this.app.setting?.close();
					} else {
						new Notice(`Unable to reveal folder: ${t.rootPath}`);
					}
				});

				// Buttons: View Members + Add Member
				const btns = row.createEl("div", {
					attr: {
						style: "display:flex; gap:6px; align-items:center;",
					},
				});
				const toggleBtn = btns.createEl("button", {
					text: "View Members",
				});
				const addMemberBtn = btns.createEl("button", {
					text: "Add Member",
				});

				// Members container (collapsed by default)
				const membersContainer = teamsListContainer.createEl("div", {
					attr: {
						style: "margin: 6px 0 8px 16px; display: none; border-left: 2px solid var(--background-modifier-border); padding-left: 10px;",
					},
				});

				const renderMembers = () => {
					membersContainer.empty();
					const raw = t.members ?? [];
					if (raw.length === 0) {
						membersContainer.createEl("em", {
							text: "No members yet.",
						});
						return;
					}

					// Sort order: Team Members, Internal Team Members, Internal Teams, External Delegates; within each, by name
					const sorted = raw.slice().sort((a, b) => {
						const typeFrom = (m: MemberInfo) => {
							const alias = (m.alias || "").toLowerCase();
							if (alias.endsWith("-ext")) return "external";
							if (alias.endsWith("-team")) return "team";
							if (alias.endsWith("-int"))
								return "internal-team-member";
							return m.type ?? "member";
						};
						const rank = (t: string) =>
							t === "member"
								? 0
								: t === "internal-team-member"
								? 1
								: t === "team"
								? 2
								: 3;
						const ta = typeFrom(a) as string;
						const tb = typeFrom(b) as string;
						const ra = rank(ta);
						const rb = rank(tb);
						if (ra !== rb) return ra - rb;
						return a.name.localeCompare(b.name);
					});

					for (const m of sorted) {
						const line = membersContainer.createEl("div", {
							attr: {
								style: "display:flex; gap:8px; align-items: center; margin: 3px 0;",
							},
						});

						const alias = (m.alias || "").toLowerCase();
						const type = alias.endsWith("-ext")
							? "external"
							: alias.endsWith("-team")
							? "team"
							: alias.endsWith("-int")
							? "internal-team-member"
							: m.type ?? "member";
						const typeLabel =
							type === "external"
								? "External Delegate"
								: type === "team"
								? "Internal Team"
								: type === "internal-team-member"
								? "Internal Team Member"
								: "Team Member";

						// Name + type
						line.createEl("span", {
							text: m.name,
							attr: { style: "min-width: 160px;" },
						});
						line.createEl("span", {
							text: `(${typeLabel})`,
							attr: { style: "color: var(--text-muted);" },
						});

						// Alias (read-only scrollable input)
						const aliasInput = line.createEl("input", {
							type: "text",
							attr: {
								style: "flex:1; min-width: 0; white-space: nowrap; overflow-x: auto; padding: 2px 6px;",
							},
						}) as HTMLInputElement;
						aliasInput.value = m.alias;
						aliasInput.readOnly = true;
						aliasInput.disabled = true;
					}
				};
				renderMembers();

				toggleBtn.addEventListener("click", () => {
					membersContainer.style.display =
						membersContainer.style.display === "none"
							? "block"
							: "none";
				});

				addMemberBtn.addEventListener("click", () => {
					// Build team list and existing internal team code map
					const teamNames = (this.plugin.settings.teams ?? []).map(
						(tt) => tt.name
					);
					const internalTeamCodes = new Map<string, string>();
					for (const tt of this.plugin.settings.teams ?? []) {
						for (const m of tt.members ?? []) {
							const lower = m.alias.toLowerCase();
							if (lower.endsWith("-team")) {
								const mm =
									/^([a-z0-9-]+)-([0-9][a-z0-9]{5})-team$/i.exec(
										m.alias
									);
								if (mm) {
									// Use the display name stored with the member to associate the code
									internalTeamCodes.set(m.name, mm[2]);
								}
							}
						}
					}

					// Build unique list of existing members across all teams (team members only)
					const uniq = new Map<string, MemberInfo>();
					for (const tt of this.plugin.settings.teams ?? []) {
						for (const m of tt.members ?? []) {
							const lower = (m.alias ?? "").toLowerCase();
							const inferredType =
								m.type ??
								(lower.endsWith("-ext")
									? "external"
									: lower.endsWith("-team")
									? "team"
									: "member");
							if (inferredType !== "member") continue; // Exclude internal teams and external delegates
							if (!uniq.has(m.alias)) {
								uniq.set(m.alias, {
									alias: m.alias,
									name: m.name,
									type: "member",
								});
							}
						}
					}
					const existingMembers = Array.from(uniq.values()).sort(
						(a, b) => a.name.localeCompare(b.name)
					);

					new AddMemberModal(
						this.app,
						t.name,
						teamNames,
						existingMembers,
						internalTeamCodes,
						async (memberName, memberAlias) => {
							// Ensure team exists in settings
							const idx = this.plugin.settings.teams.findIndex(
								(x) => x.name === t.name
							);
							if (idx === -1) return;

							const team = this.plugin.settings.teams[idx];
							team.members = team.members || [];
							if (
								!team.members.find(
									(mm) => mm.alias === memberAlias
								)
							) {
								const lower = memberAlias.toLowerCase();
								const type = lower.endsWith("-ext")
									? "external"
									: lower.endsWith("-team")
									? "team"
									: lower.endsWith("-int")
									? "internal-team-member"
									: "member";
								team.members.push({
									alias: memberAlias,
									name: memberName,
									type,
								});

								// Sort order: Team Members, Internal Team Members, Internal Teams, External Delegates; then by name
								team.members.sort((a, b) => {
									const typeFrom = (m: MemberInfo) => {
										const alias = (
											m.alias || ""
										).toLowerCase();
										if (alias.endsWith("-ext"))
											return "external";
										if (alias.endsWith("-team"))
											return "team";
										if (alias.endsWith("-int"))
											return "internal-team-member";
										return m.type ?? "member";
									};
									const rank = (t: string) =>
										t === "member"
											? 0
											: t === "internal-team-member"
											? 1
											: t === "team"
											? 2
											: 3;
									const ra = rank(typeFrom(a) as string);
									const rb = rank(typeFrom(b) as string);
									if (ra !== rb) return ra - rb;
									return a.name.localeCompare(b.name);
								});

								await this.plugin.saveSettings();
								renderMembers();
							} else {
								new Notice(
									"A member with the same alias already exists for this team."
								);
							}
						}
					).open();
				});
			}
		};

		// Render "Who are you?" selector below teams
		const renderCurrentUserSelector = () => {
			identityContainer.empty();

			// Build unique list of team members (exclude external delegates, internal teams, and internal team members)
			const uniq = new Map<string, { alias: string; name: string }>();
			for (const t of this.plugin.settings.teams ?? []) {
				for (const m of t.members ?? []) {
					const alias = (m.alias ?? "").trim();
					if (!alias) continue;
					const lower = alias.toLowerCase();
					// Exclude external delegates (-ext), internal teams (-team), and internal team members (-int)
					if (
						lower.endsWith("-ext") ||
						lower.endsWith("-team") ||
						lower.endsWith("-int")
					)
						continue;
					if (!uniq.has(alias)) {
						uniq.set(alias, { alias, name: m.name });
					}
				}
			}

			if (uniq.size === 0) {
				const emptyEl = identityContainer.createEl("div");
				emptyEl.createEl("em", {
					text: "No team members detected yet.",
				});
				return;
			}

			const members = Array.from(uniq.values()).sort((a, b) =>
				a.name.localeCompare(b.name)
			);

			new Setting(identityContainer)
				.setName("Identity")
				.setDesc("Select your identity for Agile Obsidian.")
				.addDropdown((dropdown) => {
					dropdown.addOption("", "(Not set)");
					for (const m of members) {
						dropdown.addOption(m.alias, `${m.name} (${m.alias})`);
					}
					const current = this.plugin.settings.currentUserAlias ?? "";
					dropdown.setValue(uniq.has(current) ? current : "");
					dropdown.onChange(async (value) => {
						this.plugin.settings.currentUserAlias = value || null;
						await this.plugin.saveSettings();
					});
				});
		};

		// Helper to create team folder + files, then update settings
		const createTeamResources = async (
			teamName: string,
			parentPath: string
		) => {
			const normalizedParent =
				parentPath === "/" ? "" : parentPath.replace(/\/+$/g, "");
			const teamFolder = normalizedParent
				? `${normalizedParent}/${teamName}`
				: teamName;

			if (!(await this.app.vault.adapter.exists(teamFolder))) {
				await this.app.vault.createFolder(teamFolder);
			}

			const initiativesPath = `${teamFolder}/${teamName} Initiatives.md`;
			const prioritiesPath = `${teamFolder}/${teamName} Priorities.md`;

			if (!(await this.app.vault.adapter.exists(initiativesPath))) {
				await this.app.vault.create(initiativesPath, "");
			}
			if (!(await this.app.vault.adapter.exists(prioritiesPath))) {
				await this.app.vault.create(prioritiesPath, "");
			}

			const idx = this.plugin.settings.teams.findIndex(
				(t) => t.name === teamName
			);
			const info = { name: teamName, rootPath: teamFolder, members: [] };
			if (idx === -1) {
				this.plugin.settings.teams.push(info);
			} else {
				this.plugin.settings.teams[idx] = info;
			}
			await this.plugin.saveSettings();
			renderTeamsList();
			new Notice(`Team "${teamName}" added.`);
		};

		// Initial render
		renderTeamsList();
		renderCurrentUserSelector();

		containerEl.createEl("h3", { text: "Project View" });

		// Description
		new Setting(containerEl)
			.setName("Toggle Sections")
			.setDesc(
				"Select which sections to display in project view. Note, any section containing no tasks will be hidden by default."
			)
			.setClass("setting-item-description"); // Optional: Makes it look like a plain description

		// Toggles for each section
		new Setting(containerEl)
			.setName("🎯 Objectives (OKRs)")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showObjectives)
					.onChange(async (value) => {
						this.plugin.settings.showObjectives = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("🔨 Tasks (Subtasks)")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showTasks)
					.onChange(async (value) => {
						this.plugin.settings.showTasks = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl).setName("📝 Stories").addToggle((toggle) =>
			toggle
				.setValue(this.plugin.settings.showStories)
				.onChange(async (value) => {
					this.plugin.settings.showStories = value;
					await this.plugin.saveSettings();
				})
		);

		new Setting(containerEl).setName("🏆 Epics").addToggle((toggle) =>
			toggle
				.setValue(this.plugin.settings.showEpics)
				.onChange(async (value) => {
					this.plugin.settings.showEpics = value;
					await this.plugin.saveSettings();
				})
		);

		new Setting(containerEl).setName("🎖️ Initiatives").addToggle((toggle) =>
			toggle
				.setValue(this.plugin.settings.showInitiatives)
				.onChange(async (value) => {
					this.plugin.settings.showInitiatives = value;
					await this.plugin.saveSettings();
				})
		);

		new Setting(containerEl)
			.setName("🧹 Responsibilities")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showResponsibilities)
					.onChange(async (value) => {
						this.plugin.settings.showResponsibilities = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl).setName("📁 Priorities").addToggle((toggle) =>
			toggle
				.setValue(this.plugin.settings.showPriorities)
				.onChange(async (value) => {
					this.plugin.settings.showPriorities = value;
					await this.plugin.saveSettings();
				})
		);

		// Appearance
		containerEl.createEl("h3", { text: "Appearance" });

		new Setting(containerEl)
			.setName("Custom Task Styles")
			.setDesc(
				'This plugin uses custom task styles including a customized version of SlRvb’s "Checkboxes" (from the ITS Theme) for checkbox icons. Turn this on to use the bundled styles; turn it off if you prefer your own theme/snippet for custom task styles and checkboxes.'
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.useBundledCheckboxes)
					.onChange(async (value) => {
						this.plugin.settings.useBundledCheckboxes = value;
						await this.plugin.saveSettings();
						await this.plugin.applyCheckboxStylesSetting();
					})
			);
	}
}
