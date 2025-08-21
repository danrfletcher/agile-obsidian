import { App, Notice } from "obsidian";
import type {
	AgileObsidianSettings,
	MemberInfo,
	TeamInfo,
} from "../settings.types";
import { AddMemberModal } from "../modals/AddMemberModal";
import { CreateOrganizationModal } from "../modals/CreateOrganizationModal";
import { CreateSubteamsModal } from "../modals/CreateSubteamsModal";

export type TeamsActions = {
	detectAndUpdateTeams: () => Promise<void>;
	saveSettings: () => Promise<void>;
	createTeam: (
		teamName: string,
		parentPath: string,
		teamSlug: string,
		code: string
	) => Promise<void>;
	createOrganizationFromTeam: (
		team: TeamInfo,
		orgName: string,
		suffixes: string[]
	) => Promise<void>;
	addTeamsToExistingOrganization: (
		org: TeamInfo,
		orgName: string,
		suffixes: string[]
	) => Promise<void>;
	createSubteams: (parentTeam: TeamInfo, suffixes: string[]) => Promise<void>;
};

export class TeamsPresenter {
	constructor(
		private app: App,
		private settings: AgileObsidianSettings,
		private actions: TeamsActions
	) {}

	mount(
		container: HTMLElement,
		identityContainer: HTMLElement,
		onRefreshUI: () => void
	) {
		const { orgs, orphanTeams, children } = this.computeOrgStructure();

		// Teams header
		const teamsHeader = container.createEl("h4", { text: "Teams" });
		if (orphanTeams.length === 0) {
			container.createEl("em", { text: "No teams." });
		}

		for (const t of orphanTeams) {
			const row = container.createEl("div", {
				attr: {
					style: "display:flex; gap:8px; align-items:center; margin:6px 0;",
				},
			});
			row.createEl("strong", { text: t.name });

			const pathInput = row.createEl("input", {
				type: "text",
				attr: {
					style: "flex:1; min-width:0; white-space:nowrap; overflow-x:auto; padding:2px 6px;",
				},
			}) as HTMLInputElement;
			pathInput.value = t.rootPath;
			pathInput.readOnly = true;
			pathInput.disabled = true;

			const btns = row.createEl("div", {
				attr: { style: "display:flex; gap:6px; align-items:center;" },
			});
			const viewMembersBtn = btns.createEl("button", {
				text: "View Members",
			});
			const addMemberBtn = btns.createEl("button", {
				text: "Add Member",
			});
			const createOrgBtn = btns.createEl("button", {
				text: "Create Organization",
			});

			const membersContainer = container.createEl("div", {
				attr: {
					style: "margin:6px 0 8px 16px; display:none; border-left:2px solid var(--background-modifier-border); padding-left:10px;",
				},
			});
			const renderMembers = () =>
				this.renderTeamMembers(membersContainer, t);
			renderMembers();

			viewMembersBtn.addEventListener("click", () => {
				membersContainer.style.display =
					membersContainer.style.display === "none"
						? "block"
						: "none";
			});

			addMemberBtn.addEventListener("click", () => {
				const { teamNames, internalTeamCodes, existingMembers } =
					this.buildMemberSources();
				new AddMemberModal(
					this.app,
					t.name,
					teamNames,
					existingMembers,
					internalTeamCodes,
					async (memberName, memberAlias) => {
						const idx = this.settings.teams.findIndex(
							(x) =>
								x.name === t.name && x.rootPath === t.rootPath
						);
						if (idx === -1) return;
						const team = this.settings.teams[idx];
						team.members = team.members || [];
						if (
							!team.members.find((mm) => mm.alias === memberAlias)
						) {
							const lower = memberAlias.toLowerCase();
							const type: MemberInfo["type"] = lower.endsWith(
								"-ext"
							)
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
							await this.actions.saveSettings();
							renderMembers();
							onRefreshUI();
						} else {
							new Notice(
								"A member with the same alias already exists for this team."
							);
						}
					}
				).open();
			});

			createOrgBtn.addEventListener("click", () => {
				new CreateOrganizationModal(
					this.app,
					t.name,
					async (orgName, suffixes) => {
						try {
							await this.actions.createOrganizationFromTeam(
								t,
								orgName,
								suffixes
							);
							await this.actions.detectAndUpdateTeams();
							onRefreshUI();
							new Notice(`Organization "${orgName}" created.`);
						} catch (e) {
							new Notice(`Failed to create organization: ${e}`);
						}
					}
				).open();
			});
		}

		// Orgs header
		container.createEl("h4", { text: "Organizations" });
		if (orgs.length === 0) {
			container.createEl("em", { text: "No organizations." });
		}

		for (const org of orgs) {
			const row = container.createEl("div", {
				attr: {
					style: "display:flex; gap:8px; align-items:center; margin:6px 0;",
				},
			});
			row.createEl("strong", { text: org.name });

			const pathInput = row.createEl("input", {
				type: "text",
				attr: {
					style: "flex:1; min-width:0; white-space:nowrap; overflow-x:auto; padding:2px 6px;",
				},
			}) as HTMLInputElement;
			pathInput.value = org.rootPath;
			pathInput.readOnly = true;
			pathInput.disabled = true;

			const btns = row.createEl("div", {
				attr: { style: "display:flex; gap:6px; align-items:center;" },
			});
			const toggleBtn = btns.createEl("button", {
				text: "View Members & Teams",
			});
			const addTeamBtn = btns.createEl("button", { text: "Add Team" });
			const addMemberBtn = btns.createEl("button", {
				text: "Add Member",
			});

			const orgContainer = container.createEl("div", {
				attr: {
					style: "margin:6px 0 8px 16px; display:none; border-left:2px solid var(--background-modifier-border); padding-left:10px;",
				},
			});
			const renderOrgDetails = () => {
				orgContainer.empty();
				this.renderOrgMembers(orgContainer, org);
				this.renderOrgTeams(orgContainer, org, children, onRefreshUI);
			};
			renderOrgDetails();

			toggleBtn.addEventListener("click", () => {
				orgContainer.style.display =
					orgContainer.style.display === "none" ? "block" : "none";
			});

			addTeamBtn.addEventListener("click", () => {
				new CreateOrganizationModal(
					this.app,
					org.name,
					async (orgName, suffixes) => {
						try {
							await this.actions.addTeamsToExistingOrganization(
								org,
								orgName,
								suffixes
							);
							await this.actions.detectAndUpdateTeams();
							onRefreshUI();
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
				const { teamNames, internalTeamCodes, existingMembers } =
					this.buildMemberSources();
				new AddMemberModal(
					this.app,
					org.name,
					teamNames,
					existingMembers,
					internalTeamCodes,
					async (memberName, memberAlias) => {
						const idx = this.settings.teams.findIndex(
							(x) =>
								x.name === org.name &&
								x.rootPath === org.rootPath
						);
						if (idx === -1) return;
						const team = this.settings.teams[idx];
						team.members = team.members || [];
						if (
							!team.members.find((mm) => mm.alias === memberAlias)
						) {
							const lower = memberAlias.toLowerCase();
							const type: MemberInfo["type"] = lower.endsWith(
								"-ext"
							)
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
							await this.actions.saveSettings();
							renderOrgDetails();
							onRefreshUI();
						} else {
							new Notice(
								"A member with the same alias already exists for this team."
							);
						}
					}
				).open();
			});
		}
	}

	private computeOrgStructure() {
		const teams = (this.settings.teams ?? []) as TeamInfo[];
		const byPath = new Map<string, TeamInfo>();
		const bySlug = new Map<string, TeamInfo>();
		for (const t of teams) {
			byPath.set(t.rootPath, t);
			if (t.slug) bySlug.set(t.slug.toLowerCase(), t);
		}

		// Helper: determine if childSlug is a descendant of parentSlug
		const SLUG_CODE_RE = /-([0-9][a-z0-9]{5})$/i;
		const isChildSlugOf = (
			parentSlug?: string,
			childSlug?: string
		): boolean => {
			if (!parentSlug || !childSlug) return false;
			const pm = parentSlug.match(SLUG_CODE_RE);
			const cm = childSlug.match(SLUG_CODE_RE);
			if (!pm || !cm) return false;
			if (pm[1].toLowerCase() !== cm[1].toLowerCase()) return false; // must share code
			const pBase = parentSlug
				.slice(0, parentSlug.length - 1 - pm[1].length)
				.toLowerCase();
			const cBase = childSlug
				.slice(0, childSlug.length - 1 - cm[1].length)
				.toLowerCase();
			if (!cBase.startsWith(pBase + "-")) return false; // child extends base
			if (cBase === pBase) return false; // must differ
			return true;
		};

		// Build children map strictly under Teams/ and with valid slug lineage
		const children = new Map<string, TeamInfo[]>();
		for (const parent of teams) {
			const parentSlug = parent.slug?.toLowerCase();
			if (!parentSlug) continue;
			const parentRoot = parent.rootPath.replace(/\/+$/g, "");
			const teamsFolderPrefix = parentRoot + "/Teams/";

			for (const child of teams) {
				if (child === parent) continue;
				const childSlug = child.slug?.toLowerCase();
				if (!childSlug) continue;
				if (!isChildSlugOf(parentSlug, childSlug)) continue;

				const childRoot = child.rootPath.replace(/\/+$/g, "");
				const inTeamsFolder = childRoot.startsWith(teamsFolderPrefix);
				if (!inTeamsFolder) continue; // STRICT: must be inside Teams/

				if (!children.has(parent.rootPath))
					children.set(parent.rootPath, []);
				children.get(parent.rootPath)!.push(child);
			}
		}

		// Derive orgs and orphan teams
		const orgs: TeamInfo[] = [];
		const orphanTeams: TeamInfo[] = [];

		const isChildPath = new Set<string>();
		for (const arr of children.values()) {
			for (const c of arr) isChildPath.add(c.rootPath);
		}

		for (const t of teams) {
			const isParent = (children.get(t.rootPath)?.length ?? 0) > 0;
			const isChild = isChildPath.has(t.rootPath);
			if (isParent) {
				orgs.push(t);
			} else if (!isChild) {
				orphanTeams.push(t);
			}
		}

		orgs.sort((a, b) => a.name.localeCompare(b.name));
		orphanTeams.sort((a, b) => a.name.localeCompare(b.name));
		for (const arr of children.values()) {
			arr.sort((a, b) => a.name.localeCompare(b.name));
		}

		return { orgs, orphanTeams, children };
	}

	private renderTeamMembers(container: HTMLElement, t: TeamInfo) {
		container.empty();
		const raw = t.members ?? [];
		if (raw.length === 0) {
			container.createEl("em", { text: "No members yet." });
			return;
		}
		const sorted = raw.slice().sort((a, b) => {
			const typeFrom = (m: MemberInfo) => {
				const alias = (m.alias || "").toLowerCase();
				if (alias.endsWith("-ext")) return "external";
				if (alias.endsWith("-team")) return "team";
				if (alias.endsWith("-int")) return "internal-team-member";
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
			const line = container.createEl("div", {
				attr: {
					style: "display:flex; gap:8px; align-items:center; margin:3px 0;",
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
				attr: { style: "min-width:160px;" },
			});
			line.createEl("span", {
				text: `(${typeLabel})`,
				attr: { style: "color: var(--text-muted);" },
			});
			const aliasInput = line.createEl("input", {
				type: "text",
				attr: {
					style: "flex:1; min-width:0; white-space:nowrap; overflow-x:auto; padding:2px 6px;",
				},
			}) as HTMLInputElement;
			aliasInput.value = m.alias;
			aliasInput.readOnly = true;
			aliasInput.disabled = true;
		}
	}

	private renderOrgMembers(container: HTMLElement, org: TeamInfo) {
		const members = (org.members ?? [])
			.slice()
			.sort((a, b) => a.name.localeCompare(b.name));
		container.createEl("div", {
			text: "Members",
			attr: { style: "font-weight:600; margin-top:6px;" },
		});
		if (members.length === 0) {
			container.createEl("em", { text: "No members yet." });
		} else {
			for (const m of members) {
				const line = container.createEl("div", {
					attr: {
						style: "display:flex; gap:8px; align-items:center; margin-top:4px;",
					},
				});
				line.createEl("span", { text: m.name });
				const aliasInput = line.createEl("input", {
					type: "text",
					attr: {
						style: "flex:1; min-width:0; white-space:nowrap; overflow-x:auto; padding:2px 6px;",
					},
				}) as HTMLInputElement;
				aliasInput.value = m.alias;
				aliasInput.readOnly = true;
				aliasInput.disabled = true;
			}
		}
	}

	private renderOrgTeams(
		container: HTMLElement,
		org: TeamInfo,
		children: Map<string, TeamInfo[]>,
		onRefreshUI: () => void
	) {
		container.createEl("div", {
			text: "Teams",
			attr: { style: "font-weight:600; margin-top:10px;" },
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
				attr: { style: "min-width:160px; font-weight:600;" },
			});

			const tBtns = tRow.createEl("div", {
				attr: { style: "display:flex; gap:6px; align-items:center;" },
			});
			const viewBtn = tBtns.createEl("button", {
				text: "View Members & Subteams",
			});
			const createSubBtn = tBtns.createEl("button", {
				text: "Create Subteams",
			});

			const tContainer = container.createEl("div", {
				attr: {
					style: "margin:6px 0 8px 16px; display:none; border-left:2px solid var(--background-modifier-border); padding-left:10px;",
				},
			});

			const renderTeamDetails = () => {
				tContainer.empty();
				// Members
				const tm = (team.members ?? [])
					.slice()
					.sort((a, b) => a.name.localeCompare(b.name));
				tContainer.createEl("div", {
					text: "Members",
					attr: { style: "font-weight:600; margin-top:6px;" },
				});
				if (tm.length === 0) {
					tContainer.createEl("em", { text: "No members yet." });
				} else {
					for (const m of tm) {
						const line = tContainer.createEl("div", {
							attr: {
								style: "display:flex; gap:8px; align-items:center; margin-top:4px;",
							},
						});
						line.createEl("span", { text: m.name });
						const aliasInput = line.createEl("input", {
							type: "text",
							attr: {
								style: "flex:1; min-width:0; white-space:nowrap; overflow-x:auto; padding:2px 6px;",
							},
						}) as HTMLInputElement;
						aliasInput.value = m.alias;
						aliasInput.readOnly = true;
						aliasInput.disabled = true;
					}
				}
				// Subteams listing
				const subteams = (this.settings.teams ?? [])
					.filter((st) =>
						st.rootPath.startsWith(team.rootPath + "/Teams/")
					)
					.sort((a, b) => a.name.localeCompare(b.name));
				tContainer.createEl("div", {
					text: "Subteams",
					attr: { style: "font-weight:600; margin-top:10px;" },
				});
				if (subteams.length === 0) {
					tContainer.createEl("em", { text: "No subteams yet." });
				} else {
					for (const st of subteams) {
						const stRow = tContainer.createEl("div", {
							attr: {
								style: "display:flex; gap:8px; align-items:center; margin-top:4px;",
							},
						});
						stRow.createEl("span", { text: st.name });
						const stPath = stRow.createEl("input", {
							type: "text",
							attr: {
								style: "flex:1; min-width:0; white-space:nowrap; overflow-x:auto; padding:2px 6px;",
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
					tContainer.style.display === "none" ? "block" : "none";
			});

			createSubBtn.addEventListener("click", () => {
				new CreateSubteamsModal(
					this.app,
					team.name,
					async (suffixes) => {
						try {
							await this.actions.createSubteams(team, suffixes);
							await this.actions.detectAndUpdateTeams();
							onRefreshUI();
							new Notice(
								`Created ${suffixes.length} subteam(s) under ${team.name}.`
							);
						} catch (e) {
							new Notice(`Failed to create subteams: ${e}`);
						}
					}
				).open();
			});
		}
	}

	private buildMemberSources() {
		const teamNames = (this.settings.teams ?? []).map((tt) => tt.name);
		const internalTeamCodes = new Map<string, string>();
		for (const tt of this.settings.teams ?? []) {
			for (const m of tt.members ?? []) {
				const lower = m.alias.toLowerCase();
				if (lower.endsWith("-team")) {
					const mm = /^([a-z0-9-]+)-([0-9][a-z0-9]{5})-team$/i.exec(
						m.alias
					);
					if (mm) internalTeamCodes.set(m.name, mm[2]);
				}
			}
		}

		const uniq = new Map<string, MemberInfo>();
		for (const tt of this.settings.teams ?? []) {
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
		const existingMembers = Array.from(uniq.values()).sort((a, b) =>
			a.name.localeCompare(b.name)
		);
		return { teamNames, internalTeamCodes, existingMembers };
	}
}
