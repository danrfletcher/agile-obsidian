import {
	App,
	PluginSettingTab,
	Setting,
	TFolder,
	Modal,
	Notice,
} from "obsidian";
import {
	generateShortCode,
	buildTeamSlug,
	buildResourceFolderName,
	buildResourceFileName,
	parseTeamFolderName,
	buildResourceSlug,
	getBaseCodeFromSlug,
} from "./utils/commands/commandUtils";
import AgileObsidian from "./main";

export interface TeamInfo {
	name: string;
	rootPath: string;
	members: MemberInfo[];
	// New (non-breaking optional)
	slug?: string;
}

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
		parentPath: string,
		teamSlug: string,
		code: string
	) => void | Promise<void>;

	constructor(
		app: App,
		onSubmit: (
			teamName: string,
			parentPath: string,
			teamSlug: string,
			code: string
		) => void | Promise<void>
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
		const paths = Array.from(
			new Set<string>(["/", ...folders.map((f) => f.path)])
		).sort((a, b) => a.localeCompare(b));

		for (const p of paths) {
			const opt = document.createElement("option");
			opt.value = p;
			opt.text = p === "/" ? "(vault root)" : p;
			selectEl.appendChild(opt);
		}

		// Alias preview
		const aliasPreview = contentEl.createEl("div", {
			attr: { style: "margin-top: 8px; color: var(--text-muted);" },
		});
		const code = generateShortCode();
		const aliasTitle = aliasPreview.createEl("div", {
			text: "Alias (auto-generated)",
		});
		aliasTitle.style.fontWeight = "600";
		const aliasValue = aliasPreview.createEl("code", { text: "" });

		const updateAlias = () => {
			const teamName = nameInput.value.trim() || "sample";
			const slug = buildTeamSlug(teamName, code, null);
			aliasValue.textContent = slug;
		};
		nameInput.addEventListener("input", updateAlias);
		updateAlias();

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
			const slug = buildTeamSlug(teamName, code, null);
			await this.onSubmit(teamName, parentPath, slug, code);
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class CreateOrganizationModal extends Modal {
	private initialOrgName: string;
	private onSubmit: (
		orgName: string,
		teamSuffixes: string[]
	) => void | Promise<void>;

	constructor(
		app: App,
		initialOrgName: string,
		onSubmit: (
			orgName: string,
			teamSuffixes: string[]
		) => void | Promise<void>
	) {
		super(app);
		this.initialOrgName = initialOrgName;
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h3", { text: "Create Organization From Team" });

		// Org name input
		const nameWrap = contentEl.createEl("div", {
			attr: { style: "margin-bottom: 12px;" },
		});
		nameWrap.createEl("label", {
			text: "Organization Name",
			attr: { style: "display:block; margin-bottom:4px;" },
		});
		const orgNameInput = nameWrap.createEl("input", {
			type: "text",
			attr: { style: "width:100%;" },
		}) as HTMLInputElement;
		orgNameInput.value = this.initialOrgName;

		// Teams list
		const listWrap = contentEl.createEl("div");
		const addBtnWrap = contentEl.createEl("div", {
			attr: { style: "margin-top: 6px;" },
		});
		const addTeamBtn = addBtnWrap.createEl("button", {
			text: "Add Another Team",
		});

		type TeamRow = {
			row: HTMLDivElement;
			prefixSpan: HTMLSpanElement;
			suffixInput: HTMLInputElement;
		};
		const rows: TeamRow[] = [];

		const addRow = (index: number) => {
			const row = listWrap.createEl("div", {
				attr: {
					style: "display:flex; gap:6px; align-items:center; margin-top: 8px;",
				},
			});
			row.createEl("label", {
				text: `Team ${index + 1}`,
				attr: { style: "width: 90px;" },
			});

			const prefixSpan = row.createEl("span", {
				text: `${orgNameInput.value} `,
				attr: { style: "font-weight:600;" },
			});
			const suffixInput = row.createEl("input", {
				type: "text",
				attr: {
					placeholder:
						index === 0
							? "Enter first team name..."
							: index === 1
							? "Enter second team name..."
							: "Enter team name...",
					style: "flex:1;",
				},
			}) as HTMLInputElement;

			rows.push({ row, prefixSpan, suffixInput });
		};

		addRow(0);

		addTeamBtn.addEventListener("click", () => {
			addRow(rows.length);
		});

		orgNameInput.addEventListener("input", () => {
			for (const r of rows) {
				r.prefixSpan.textContent = `${orgNameInput.value} `;
			}
		});

		// Buttons
		const btns = contentEl.createEl("div", {
			attr: {
				style: "display:flex; gap:8px; justify-content:flex-end; margin-top: 16px;",
			},
		});
		const cancel = btns.createEl("button", { text: "Cancel" });
		cancel.addEventListener("click", () => this.close());
		const create = btns.createEl("button", { text: "Create Organization" });
		create.addEventListener("click", async () => {
			const orgName = orgNameInput.value.trim();
			if (!orgName) {
				new Notice("Please enter an organization name.");
				return;
			}
			const suffixes = rows
				.map((r) => r.suffixInput.value.trim())
				.filter(Boolean);
			if (suffixes.length === 0) {
				new Notice("Add at least one team.");
				return;
			}
			await this.onSubmit(orgName, suffixes);
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class CreateSubteamsModal extends Modal {
	private parentTeamName: string;
	private onSubmit: (suffixes: string[]) => void | Promise<void>;

	constructor(
		app: App,
		parentTeamName: string,
		onSubmit: (suffixes: string[]) => void | Promise<void>
	) {
		super(app);
		this.parentTeamName = parentTeamName;
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h3", { text: "Create Subteams" });

		const info = contentEl.createEl("div", {
			attr: { style: "margin-bottom: 8px; color: var(--text-muted);" },
		});
		info.setText(`Parent team: ${this.parentTeamName}`);

		const listWrap = contentEl.createEl("div");
		const addBtnWrap = contentEl.createEl("div", {
			attr: { style: "margin-top: 6px;" },
		});
		const addTeamBtn = addBtnWrap.createEl("button", {
			text: "Add Subteam",
		});

		type Row = {
			row: HTMLDivElement;
			prefixSpan: HTMLSpanElement;
			suffixInput: HTMLInputElement;
		};
		const rows: Row[] = [];

		const addRow = (index: number) => {
			const row = listWrap.createEl("div", {
				attr: {
					style: "display:flex; gap:6px; align-items:center; margin-top: 8px;",
				},
			});
			row.createEl("label", {
				text: `Team ${index + 1}`,
				attr: { style: "width: 90px;" },
			});

			const prefixSpan = row.createEl("span", {
				text: `${this.parentTeamName} `,
				attr: { style: "font-weight:600;" },
			});
			const suffixInput = row.createEl("input", {
				type: "text",
				attr: {
					placeholder:
						index === 0
							? "Enter first subteam name..."
							: index === 1
							? "Enter second subteam name..."
							: "Enter subteam name...",
					style: "flex:1;",
				},
			}) as HTMLInputElement;

			rows.push({ row, prefixSpan, suffixInput });
		};

		addRow(0);

		addTeamBtn.addEventListener("click", () => {
			addRow(rows.length);
		});

		// Buttons
		const btns = contentEl.createEl("div", {
			attr: {
				style: "display:flex; gap:8px; justify-content:flex-end; margin-top: 16px;",
			},
		});
		const cancel = btns.createEl("button", { text: "Cancel" });
		cancel.addEventListener("click", () => this.close());
		const create = btns.createEl("button", { text: "Create Subteams" });
		create.addEventListener("click", async () => {
			const suffixes = rows
				.map((r) => r.suffixInput.value.trim())
				.filter(Boolean);
			if (suffixes.length === 0) {
				new Notice("Add at least one subteam.");
				return;
			}
			await this.onSubmit(suffixes);
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
			.setDesc(
				"Detects teams and organizations from your vault and adds new teams."
			);
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
				new AddTeamModal(
					this.app,
					async (teamName, parentPath, teamSlug, code) => {
						try {
							await createTeamResources(
								teamName,
								parentPath,
								teamSlug,
								code
							);
						} catch (e) {
							new Notice(`Failed to add team: ${e}`);
						}
					}
				).open();
			})
		);

		// Container to display teams and organizations
		const teamsListContainer = containerEl.createEl("div");
		const identityContainer = containerEl.createEl("div", {
			attr: { style: "padding-top: 12px;" },
		});

		// Helper: compute organization structure derived from folder layout/slugs
		type TeamEntry = TeamInfo & { slug?: string };
		const computeOrgStructure = () => {
			const teams = (this.plugin.settings.teams ?? []) as TeamEntry[];

			// Index by rootPath for quick lookup
			const byPath = new Map<string, TeamEntry>();
			for (const t of teams) byPath.set(t.rootPath, t);

			// Build children map: parentPath -> child teams
			const children = new Map<string, TeamEntry[]>();
			for (const t of teams) {
				// A team is a child of a parent org if it's inside "<Parent>/Teams/<Child>"
				const segs = t.rootPath.split("/").filter(Boolean);
				const idx = segs.lastIndexOf("Teams");
				if (idx > 0) {
					const parentPath = segs.slice(0, idx).join("/");
					if (byPath.has(parentPath)) {
						if (!children.has(parentPath))
							children.set(parentPath, []);
						children.get(parentPath)!.push(t);
					}
				}
			}

			// Organizations are those that have any children
			const orgs: TeamEntry[] = [];
			const orphanTeams: TeamEntry[] = [];
			for (const t of teams) {
				if (children.has(t.rootPath)) {
					orgs.push(t);
				} else {
					// If this team is inside some parent Teams folder, do not treat as orphan
					const segs = t.rootPath.split("/").filter(Boolean);
					const idx = segs.lastIndexOf("Teams");
					if (idx === -1) {
						orphanTeams.push(t);
					}
				}
			}

			// Sort alphabetical
			orgs.sort((a, b) => a.name.localeCompare(b.name));
			orphanTeams.sort((a, b) => a.name.localeCompare(b.name));
			for (const arr of children.values())
				arr.sort((a, b) => a.name.localeCompare(b.name));

			return { orgs, orphanTeams, children };
		};

		// Render teams helper
		const renderTeamsList = () => {
			teamsListContainer.empty();
			const { orgs, orphanTeams, children } = computeOrgStructure();

			// Orphan Teams section
			const orphanHeader = teamsListContainer.createEl("h4", {
				text: "Teams",
			});
			if (orphanTeams.length === 0) {
				teamsListContainer.createEl("em", { text: "No orphan teams." });
			}
			for (const t of orphanTeams) {
				const row = teamsListContainer.createEl("div", {
					attr: {
						style: "display: flex; gap: 8px; align-items: center; margin: 6px 0;",
					},
				});

				// Team name
				row.createEl("strong", { text: t.name });

				// Scrollable, disabled input showing the path
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

				// Buttons: View Members + Add Member + Create Organization
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
				const createOrgBtn = btns.createEl("button", {
					text: "Create Organization",
				});

				// Members container
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

						line.createEl("span", {
							text: m.name,
							attr: { style: "min-width: 160px;" },
						});
						line.createEl("span", {
							text: `(${typeLabel})`,
							attr: { style: "color: var(--text-muted);" },
						});
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
					// Build team list and existing internal team code map (reuse your existing logic)
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
									internalTeamCodes.set(m.name, mm[2]);
								}
							}
						}
					}

					// Unique list of team members across all teams (team members only)
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
							if (inferredType !== "member") continue;
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
							const idx = this.plugin.settings.teams.findIndex(
								(x) =>
									x.name === t.name &&
									x.rootPath === t.rootPath
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

				// Create Organization click
				createOrgBtn.addEventListener("click", () => {
					new CreateOrganizationModal(
						this.app,
						t.name,
						async (orgName, suffixes) => {
							try {
								await createOrganizationFromTeam(
									t,
									orgName,
									suffixes
								);
								await this.plugin.detectAndUpdateTeams();
								renderTeamsList();
								renderCurrentUserSelector();
								new Notice(
									`Organization "${orgName}" created.`
								);
							} catch (e) {
								new Notice(
									`Failed to create organization: ${e}`
								);
							}
						}
					).open();
				});
			}

			// Organizations section
			const orgHeader = teamsListContainer.createEl("h4", {
				text: "Organizations",
			});
			if (orgs.length === 0) {
				teamsListContainer.createEl("em", {
					text: "No organizations.",
				});
			}
			for (const org of orgs) {
				const row = teamsListContainer.createEl("div", {
					attr: {
						style: "display: flex; gap: 8px; align-items: center; margin: 6px 0;",
					},
				});
				row.createEl("strong", { text: org.name });

				const pathInput = row.createEl("input", {
					type: "text",
					attr: {
						style: "flex: 1; min-width: 0; white-space: nowrap; overflow-x: auto; padding: 2px 6px;",
					},
				}) as HTMLInputElement;
				pathInput.value = org.rootPath;
				pathInput.readOnly = true;
				pathInput.disabled = true;

				const btns = row.createEl("div", {
					attr: {
						style: "display:flex; gap:6px; align-items:center;",
					},
				});
				const toggleBtn = btns.createEl("button", {
					text: "View Members & Teams",
				});
				const addTeamBtn = btns.createEl("button", {
					text: "Add Team",
				});
				const addMemberBtn = btns.createEl("button", {
					text: "Add Member",
				});

				const container = teamsListContainer.createEl("div", {
					attr: {
						style: "margin: 6px 0 8px 16px; display: none; border-left: 2px solid var(--background-modifier-border); padding-left: 10px;",
					},
				});

				const renderOrgDetails = () => {
					container.empty();

					// Top-level members (if any) shown first
					const members = (org.members ?? [])
						.slice()
						.sort((a, b) => a.name.localeCompare(b.name));
					const membersTitle = container.createEl("div", {
						text: "Members",
						attr: { style: "font-weight: 600; margin-top: 6px;" },
					});
					if (members.length === 0) {
						container.createEl("em", { text: "No members yet." });
					} else {
						for (const m of members) {
							const line = container.createEl("div", {
								attr: {
									style: "display:flex; gap:8px; align-items:center; margin-top: 4px;",
								},
							});
							line.createEl("span", { text: m.name });
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
					}

					// Teams
					const teamsTitle = container.createEl("div", {
						text: "Teams",
						attr: { style: "font-weight: 600; margin-top: 10px;" },
					});
					const kids = children.get(org.rootPath) ?? [];
					for (const team of kids) {
						const tRow = container.createEl("div", {
							attr: {
								style: "display:flex; gap:8px; align-items:center; margin-top:6px;",
							},
						});
						tRow.createEl("span", {
							text: team.name,
							attr: {
								style: "min-width: 160px; font-weight: 600;",
							},
						});

						const tBtns = tRow.createEl("div", {
							attr: {
								style: "display:flex; gap:6px; align-items:center;",
							},
						});
						const viewBtn = tBtns.createEl("button", {
							text: "View Members & Subteams",
						});
						const createSubBtn = tBtns.createEl("button", {
							text: "Create Subteams",
						});

						const tContainer = container.createEl("div", {
							attr: {
								style: "margin: 6px 0 8px 16px; display: none; border-left: 2px solid var(--background-modifier-border); padding-left: 10px;",
							},
						});

						const renderTeamDetails = () => {
							tContainer.empty();

							// Team members
							const tm = (team.members ?? [])
								.slice()
								.sort((a, b) => a.name.localeCompare(b.name));
							const tmTitle = tContainer.createEl("div", {
								text: "Members",
								attr: {
									style: "font-weight:600; margin-top:6px;",
								},
							});
							if (tm.length === 0) {
								tContainer.createEl("em", {
									text: "No members yet.",
								});
							} else {
								for (const m of tm) {
									const line = tContainer.createEl("div", {
										attr: {
											style: "display:flex; gap:8px; align-items:center; margin-top: 4px;",
										},
									});
									line.createEl("span", { text: m.name });
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
							}

							// Subteams under this team: look for "<team>/Teams/*"
							const segs = team.rootPath
								.split("/")
								.filter(Boolean);
							const subteams = (this.plugin.settings.teams ?? [])
								.filter((st) =>
									st.rootPath.startsWith(
										team.rootPath + "/Teams/"
									)
								)
								.sort((a, b) => a.name.localeCompare(b.name));

							const stTitle = tContainer.createEl("div", {
								text: "Subteams",
								attr: {
									style: "font-weight:600; margin-top:10px;",
								},
							});
							if (subteams.length === 0) {
								tContainer.createEl("em", {
									text: "No subteams yet.",
								});
							} else {
								for (const st of subteams) {
									const stRow = tContainer.createEl("div", {
										attr: {
											style: "display:flex; gap:8px; align-items:center; margin-top: 4px;",
										},
									});
									stRow.createEl("span", { text: st.name });
									const stPath = stRow.createEl("input", {
										type: "text",
										attr: {
											style: "flex:1; min-width: 0; white-space: nowrap; overflow-x: auto; padding: 2px 6px;",
										},
									}) as HTMLInputElement;
									stPath.value = st.rootPath;
									stPath.readOnly = true;
									stPath.disabled = true;
								}
							}
						};
						renderTeamDetails();

						viewBtn.addEventListener("click", () => {
							tContainer.style.display =
								tContainer.style.display === "none"
									? "block"
									: "none";
						});

						createSubBtn.addEventListener("click", () => {
							new CreateSubteamsModal(
								this.app,
								team.name,
								async (suffixes) => {
									try {
										await createSubteams(team, suffixes);
										await this.plugin.detectAndUpdateTeams();
										renderTeamsList();
										renderCurrentUserSelector();
										new Notice(
											`Created ${suffixes.length} subteam(s) under ${team.name}.`
										);
									} catch (e) {
										new Notice(
											`Failed to create subteams: ${e}`
										);
									}
								}
							).open();
						});
					}
				};
				renderOrgDetails();

				toggleBtn.addEventListener("click", () => {
					container.style.display =
						container.style.display === "none" ? "block" : "none";
				});

				addTeamBtn.addEventListener("click", () => {
					// Add a sibling team under the org root (as a new leaf team in the org)
					new CreateOrganizationModal(
						this.app,
						org.name,
						async (orgName, suffixes) => {
							try {
								// Only create new teams; do not restructure existing org this way
								await addTeamsToExistingOrganization(
									org,
									orgName,
									suffixes
								);
								await this.plugin.detectAndUpdateTeams();
								renderTeamsList();
								renderCurrentUserSelector();
								new Notice(
									`Added ${suffixes.length} team(s) to ${orgName}.`
								);
							} catch (e) {
								new Notice(`Failed to add team(s): ${e}`);
							}
						}
					).open();
				});

				addMemberBtn.addEventListener("click", () => {
					// Reuse orphan logic for adding members to org root
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
								if (mm) internalTeamCodes.set(m.name, mm[2]);
							}
						}
					}

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
							if (inferredType !== "member") continue;
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
						org.name,
						teamNames,
						existingMembers,
						internalTeamCodes,
						async (memberName, memberAlias) => {
							const idx = this.plugin.settings.teams.findIndex(
								(x) =>
									x.name === org.name &&
									x.rootPath === org.rootPath
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
								team.members.sort((a, b) =>
									a.name.localeCompare(b.name)
								);
								await this.plugin.saveSettings();
								renderOrgDetails();
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

		// Helper to create team folder + files using slug convention, then update settings
		const createTeamResources = async (
			teamName: string,
			parentPath: string,
			teamSlug: string,
			code: string
		) => {
			const normalizedParent =
				parentPath === "/" ? "" : parentPath.replace(/\/+$/g, "");
			const teamFolderName = `${teamName} (${teamSlug})`;
			const teamFolder = normalizedParent
				? `${normalizedParent}/${teamFolderName}`
				: teamFolderName;

			if (!(await this.app.vault.adapter.exists(teamFolder))) {
				await this.app.vault.createFolder(teamFolder);
			}

			// Optional top-level Docs
			const docsPath = `${teamFolder}/Docs`;
			if (!(await this.app.vault.adapter.exists(docsPath))) {
				await this.app.vault.createFolder(docsPath);
			}

			// Projects/Initiatives folder + files
			const projectsPath = `${teamFolder}/Projects`;
			if (!(await this.app.vault.adapter.exists(projectsPath))) {
				await this.app.vault.createFolder(projectsPath);
			}
			const initiativesFolderName = buildResourceFolderName(
				"initiatives",
				code,
				null
			);
			const initiativesDir = `${projectsPath}/${initiativesFolderName}`;
			if (!(await this.app.vault.adapter.exists(initiativesDir))) {
				await this.app.vault.createFolder(initiativesDir);
			}

			const completedFile = `${initiativesDir}/${buildResourceFileName(
				"completed",
				code,
				null
			)}`;
			const initiativesFile = `${initiativesDir}/${buildResourceFileName(
				"initiatives",
				code,
				null
			)}`;
			const prioritiesFile = `${initiativesDir}/${buildResourceFileName(
				"priorities",
				code,
				null
			)}`;

			if (!(await this.app.vault.adapter.exists(completedFile))) {
				await this.app.vault.create(completedFile, "");
			}
			if (!(await this.app.vault.adapter.exists(initiativesFile))) {
				await this.app.vault.create(initiativesFile, "");
			}
			if (!(await this.app.vault.adapter.exists(prioritiesFile))) {
				await this.app.vault.create(prioritiesFile, "");
			}

			// Update settings (idempotent)
			const idx = this.plugin.settings.teams.findIndex(
				(t) => t.name === teamName && t.rootPath === teamFolder
			);
			const info = {
				name: teamName,
				rootPath: teamFolder,
				members: [],
				slug: teamSlug,
			};
			if (idx === -1) {
				this.plugin.settings.teams.push(info);
			} else {
				this.plugin.settings.teams[idx] = info as any;
			}
			await this.plugin.saveSettings();
			renderTeamsList();
			new Notice(`Team "${teamName}" added.`);
		};

		// Create organization from an orphan team
		const createOrganizationFromTeam = async (
			team: TeamInfo,
			orgName: string,
			suffixes: string[]
		) => {
			// Team currently lives at team.rootPath, named "Name (slug)". Extract slug/code.
			const segments = team.rootPath.split("/").filter(Boolean);
			const currentFolderName = segments[segments.length - 1];
			const parsed = parseTeamFolderName(currentFolderName);
			let originalCode: string;
			if (parsed) {
				originalCode = parsed.code;
			} else {
				const fallbackSlug = team.slug ?? null;
				const fromSlug = fallbackSlug ? getBaseCodeFromSlug(fallbackSlug) : null;
				originalCode = fromSlug || generateShortCode();
			}
			const orgBaseSlug = buildTeamSlug(orgName, originalCode, null); // e.g., "nueral-6fg1hj"

			// If org name changed, rename folder "<OldName> (old-slug)" -> "<NewName> (new-slug)"
			const parentDir = segments.slice(0, -1).join("/");
			const newOrgFolderName = `${orgName} (${orgBaseSlug})`;
			const newOrgPath = parentDir
				? `${parentDir}/${newOrgFolderName}`
				: newOrgFolderName;

			if (newOrgPath !== team.rootPath) {
				const af = this.app.vault.getAbstractFileByPath(team.rootPath);
				if (!af) {
					// Fallback: if adapter can see the path, rename via adapter
					const exists = await this.app.vault.adapter.exists(team.rootPath);
					if (!exists) {
						throw new Error(`Original team folder not found: ${team.rootPath}`);
					}
					await this.app.vault.adapter.rename(team.rootPath, newOrgPath);
				} else {
					// @ts-ignore
					await this.app.vault.rename(af, newOrgPath);
				}
				team.rootPath = newOrgPath;
			}

			// Create Teams folder
			const teamsDir = `${team.rootPath}/Teams`;
			if (!(await this.app.vault.adapter.exists(teamsDir))) {
				await this.app.vault.createFolder(teamsDir);
			}

			// Move existing Projects into "OrgName A (...)" as first child
			const firstSuffix = suffixes[0];
			const pathIdFirst = "a";
			const firstTeamName = `${orgName} ${firstSuffix}`;
			const firstTeamSlug = buildTeamSlug(
				orgName,
				originalCode,
				pathIdFirst
			);
			const firstTeamFolder = `${teamsDir}/${firstTeamName} (${firstTeamSlug})`;

			if (!(await this.app.vault.adapter.exists(firstTeamFolder))) {
				await this.app.vault.createFolder(firstTeamFolder);
			}

			// Ensure child Projects exists and move/migrate resources
			const srcProjects = `${team.rootPath}/Projects`;
			if (await this.app.vault.adapter.exists(srcProjects)) {
				// Move entire Projects under child team
				const srcProjectsAf =
					this.app.vault.getAbstractFileByPath(srcProjects);
				if (srcProjectsAf) {
					// @ts-ignore
					await this.app.vault.rename(
						srcProjectsAf,
						`${firstTeamFolder}/Projects`
					);
				}
				// After move, rename initiatives dir / contained files to include "-a-" in resource slugs
				const initiativesDirName = buildResourceFolderName(
					"initiatives",
					originalCode,
					null
				);
				const movedInitiativesDir = `${firstTeamFolder}/Projects/${initiativesDirName}`;
				if (await this.app.vault.adapter.exists(movedInitiativesDir)) {
					const af =
						this.app.vault.getAbstractFileByPath(
							movedInitiativesDir
						);
					if (af) {
						const newDirName = buildResourceFolderName(
							"initiatives",
							originalCode,
							pathIdFirst
						);
						const newDirPath = `${firstTeamFolder}/Projects/${newDirName}`;
						// @ts-ignore
						await this.app.vault.rename(af, newDirPath);

						// Rename the three files inside if present
						const renameIfExists = async (
							kind: "completed" | "initiatives" | "priorities"
						) => {
							const oldName = buildResourceFileName(
								kind,
								originalCode,
								null
							);
							const newName = buildResourceFileName(
								kind,
								originalCode,
								pathIdFirst
							);
							const oldPath = `${newDirPath}/${oldName}`;
							if (await this.app.vault.adapter.exists(oldPath)) {
								const fileAf =
									this.app.vault.getAbstractFileByPath(
										oldPath
									);
								if (fileAf) {
									// @ts-ignore
									await this.app.vault.rename(
										fileAf,
										`${newDirPath}/${newName}`
									);
								}
							}
						};
						await renameIfExists("completed");
						await renameIfExists("initiatives");
						await renameIfExists("priorities");
					}
				}
			} else {
				// No existing projects; create fresh resources for first team
				const childProjects = `${firstTeamFolder}/Projects`;
				if (!(await this.app.vault.adapter.exists(childProjects))) {
					await this.app.vault.createFolder(childProjects);
				}
				const childInitDirName = buildResourceFolderName(
					"initiatives",
					originalCode,
					pathIdFirst
				);
				const childInitDir = `${childProjects}/${childInitDirName}`;
				if (!(await this.app.vault.adapter.exists(childInitDir))) {
					await this.app.vault.createFolder(childInitDir);
				}
				const completedFile = `${childInitDir}/${buildResourceFileName(
					"completed",
					originalCode,
					pathIdFirst
				)}`;
				const initiativesFile = `${childInitDir}/${buildResourceFileName(
					"initiatives",
					originalCode,
					pathIdFirst
				)}`;
				const prioritiesFile = `${childInitDir}/${buildResourceFileName(
					"priorities",
					originalCode,
					pathIdFirst
				)}`;
				if (!(await this.app.vault.adapter.exists(completedFile)))
					await this.app.vault.create(completedFile, "");
				if (!(await this.app.vault.adapter.exists(initiativesFile)))
					await this.app.vault.create(initiativesFile, "");
				if (!(await this.app.vault.adapter.exists(prioritiesFile)))
					await this.app.vault.create(prioritiesFile, "");
			}

			// Create any additional sibling teams B, C, ...
			const letters = "abcdefghijklmnopqrstuvwxyz";
			for (let i = 1; i < suffixes.length; i++) {
				const letter = letters[i] || `x${i}`;
				const pathId = letter;
				const name = `${orgName} ${suffixes[i]}`;
				const slug = buildTeamSlug(orgName, originalCode, pathId);
				const folder = `${teamsDir}/${name} (${slug})`;
				if (!(await this.app.vault.adapter.exists(folder))) {
					await this.app.vault.createFolder(folder);
				}
				// Seed Projects/Initiatives
				const projects = `${folder}/Projects`;
				if (!(await this.app.vault.adapter.exists(projects))) {
					await this.app.vault.createFolder(projects);
				}
				const initDirName = buildResourceFolderName(
					"initiatives",
					originalCode,
					pathId
				);
				const initDir = `${projects}/${initDirName}`;
				if (!(await this.app.vault.adapter.exists(initDir))) {
					await this.app.vault.createFolder(initDir);
				}
				const completedFile = `${initDir}/${buildResourceFileName(
					"completed",
					originalCode,
					pathId
				)}`;
				const initiativesFile = `${initDir}/${buildResourceFileName(
					"initiatives",
					originalCode,
					pathId
				)}`;
				const prioritiesFile = `${initDir}/${buildResourceFileName(
					"priorities",
					originalCode,
					pathId
				)}`;
				if (!(await this.app.vault.adapter.exists(completedFile)))
					await this.app.vault.create(completedFile, "");
				if (!(await this.app.vault.adapter.exists(initiativesFile)))
					await this.app.vault.create(initiativesFile, "");
				if (!(await this.app.vault.adapter.exists(prioritiesFile)))
					await this.app.vault.create(prioritiesFile, "");
			}
		};

		// Add teams to an existing org (without restructuring)
		const addTeamsToExistingOrganization = async (
			org: TeamInfo,
			orgName: string,
			suffixes: string[]
		) => {
			// Org rootPath and slug code
			const segs = org.rootPath.split("/").filter(Boolean);
			const folderName = segs[segs.length - 1];
			const parsed = parseTeamFolderName(folderName);
			if (!parsed) throw new Error("Organization folder has no slug.");
			const code = parsed.code;

			// Create Teams dir
			const teamsDir = `${org.rootPath}/Teams`;
			if (!(await this.app.vault.adapter.exists(teamsDir))) {
				await this.app.vault.createFolder(teamsDir);
			}

			const letters = "abcdefghijklmnopqrstuvwxyz";
			// Determine next letter index from existing teams
			const children = (this.plugin.settings.teams ?? []).filter((t) =>
				t.rootPath.startsWith(teamsDir + "/")
			);
			const usedLetters = new Set<string>();
			for (const c of children) {
				const nm = c.name.trim();
				const suf = nm.startsWith(orgName + " ")
					? nm.slice(orgName.length + 1).trim()
					: nm;
				// We can't reliably infer the letter from name; rely on folder slug
				const cFolderName = c.rootPath
					.split("/")
					.filter(Boolean)
					.pop()!;
				const p = parseTeamFolderName(cFolderName);
				if (p?.pathId) {
					const letter = p.pathId.split("-")[0]; // take first segment
					if (letter) usedLetters.add(letter);
				}
			}

			let letterIdx = 0;
			while (
				letterIdx < letters.length &&
				usedLetters.has(letters[letterIdx])
			) {
				letterIdx++;
			}

			for (let i = 0; i < suffixes.length; i++) {
				const letter = letters[letterIdx] || `x${letterIdx}`;
				letterIdx++;
				while (
					letterIdx < letters.length &&
					usedLetters.has(letters[letterIdx])
				) {
					letterIdx++;
				}

				const pathId = letter;
				const name = `${orgName} ${suffixes[i]}`;
				const slug = buildTeamSlug(orgName, code, pathId);
				const folder = `${teamsDir}/${name} (${slug})`;
				if (!(await this.app.vault.adapter.exists(folder))) {
					await this.app.vault.createFolder(folder);
				}
				// Seed Projects/Initiatives
				const projects = `${folder}/Projects`;
				if (!(await this.app.vault.adapter.exists(projects))) {
					await this.app.vault.createFolder(projects);
				}
				const initDirName = buildResourceFolderName(
					"initiatives",
					code,
					pathId
				);
				const initDir = `${projects}/${initDirName}`;
				if (!(await this.app.vault.adapter.exists(initDir))) {
					await this.app.vault.createFolder(initDir);
				}
				const completedFile = `${initDir}/${buildResourceFileName(
					"completed",
					code,
					pathId
				)}`;
				const initiativesFile = `${initDir}/${buildResourceFileName(
					"initiatives",
					code,
					pathId
				)}`;
				const prioritiesFile = `${initDir}/${buildResourceFileName(
					"priorities",
					code,
					pathId
				)}`;
				if (!(await this.app.vault.adapter.exists(completedFile)))
					await this.app.vault.create(completedFile, "");
				if (!(await this.app.vault.adapter.exists(initiativesFile)))
					await this.app.vault.create(initiativesFile, "");
				if (!(await this.app.vault.adapter.exists(prioritiesFile)))
					await this.app.vault.create(prioritiesFile, "");
			}
		};

		// Create subteams under an existing team
		const createSubteams = async (
			parentTeam: TeamInfo,
			suffixes: string[]
		) => {
			const parentSegs = parentTeam.rootPath.split("/").filter(Boolean);
			const parentFolderName = parentSegs[parentSegs.length - 1];
			const parsed = parseTeamFolderName(parentFolderName);
			if (!parsed) throw new Error("Parent team folder has no slug.");
			const code = parsed.code;
			const orgName = parsed.name;
			const parentPathId = parsed.pathId || null; // e.g., "a" or "b-2"

			// Ensure Teams dir under parent
			const teamsDir = `${parentTeam.rootPath}/Teams`;
			if (!(await this.app.vault.adapter.exists(teamsDir))) {
				await this.app.vault.createFolder(teamsDir);
			}

			// Determine next numeric suffix for subteams under this parent
			const existing = (this.plugin.settings.teams ?? []).filter((t) =>
				t.rootPath.startsWith(teamsDir + "/")
			);
			const usedNums = new Set<number>();
			for (const st of existing) {
				const folderName = st.rootPath
					.split("/")
					.filter(Boolean)
					.pop()!;
				const p = parseTeamFolderName(folderName);
				if (p?.pathId) {
					const parts = p.pathId.split("-");
					const last = parts[parts.length - 1];
					const n = parseInt(last, 10);
					if (Number.isFinite(n)) usedNums.add(n);
				}
			}
			let n = 1;
			const nextNum = () => {
				while (usedNums.has(n)) n++;
				const val = n;
				usedNums.add(n);
				return val;
			};

			for (const suf of suffixes) {
				const num = nextNum();
				const childPathId = parentPathId
					? `${parentPathId}-${num}`
					: `${num}`;
				const name = `${orgName} ${suf}`;
				const slug = buildTeamSlug(orgName, code, childPathId);
				const folder = `${teamsDir}/${name} (${slug})`;
				if (!(await this.app.vault.adapter.exists(folder))) {
					await this.app.vault.createFolder(folder);
				}

				// Seed Projects/Initiatives
				const projects = `${folder}/Projects`;
				if (!(await this.app.vault.adapter.exists(projects))) {
					await this.app.vault.createFolder(projects);
				}
				const initDirName = buildResourceFolderName(
					"initiatives",
					code,
					childPathId
				);
				const initDir = `${projects}/${initDirName}`;
				if (!(await this.app.vault.adapter.exists(initDir))) {
					await this.app.vault.createFolder(initDir);
				}
				const completedFile = `${initDir}/${buildResourceFileName(
					"completed",
					code,
					childPathId
				)}`;
				const initiativesFile = `${initDir}/${buildResourceFileName(
					"initiatives",
					code,
					childPathId
				)}`;
				const prioritiesFile = `${initDir}/${buildResourceFileName(
					"priorities",
					code,
					childPathId
				)}`;
				if (!(await this.app.vault.adapter.exists(completedFile)))
					await this.app.vault.create(completedFile, "");
				if (!(await this.app.vault.adapter.exists(initiativesFile)))
					await this.app.vault.create(initiativesFile, "");
				if (!(await this.app.vault.adapter.exists(prioritiesFile)))
					await this.app.vault.create(prioritiesFile, "");
			}
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
			.setClass("setting-item-description");

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
