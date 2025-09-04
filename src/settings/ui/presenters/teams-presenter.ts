/**
 * Presents teams and organizations management UI within the settings panel.
 * Renders teams, organizations, member lists, and supports add/create actions.
 * Side-effects: Manipulates DOM, triggers actions ports, and requests save/refresh.
 */
import { App, Notice } from "obsidian";
import type { AgileObsidianSettings } from "@settings";
import { AddMemberModal } from "../modals/add-member-modal";
import { CreateOrganizationModal } from "../modals/create-organization-modal";
import { CreateSubteamsModal } from "../modals/create-subteams-modal";
import { getDisplayNameFromAlias } from "@shared/identity";
import type { SettingsOrgActions } from "../../app/contracts";
import type { MemberInfo, TeamInfo } from "@features/org-structure";

// New helpers imported from org-structure API
import {
	computeOrgStructureView,
	classifyMember,
} from "@features/org-structure";

export type TeamsActions = SettingsOrgActions;

export class TeamsPresenter {
	constructor(
		private app: App,
		private settings: AgileObsidianSettings,
		private actions: TeamsActions
	) {}

	/**
	 * Mount the presenter UI and wire interactions.
	 * - Populates orphan teams and organizations views (via org-structure API helpers).
	 * - Wires creation/modification modals and refresh logic.
	 */
	mount(
		container: HTMLElement,
		_identityContainer: HTMLElement,
		onRefreshUI: () => void
	) {
		const teams = (this.settings.teams ?? []) as TeamInfo[];
		const { orgs, orphanTeams, children } = computeOrgStructureView(teams);

		// Teams header
		container.createEl("h4", { text: "Teams" });
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
								getDisplayNameFromAlias(a.alias).localeCompare(
									getDisplayNameFromAlias(b.alias)
								)
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
			const addTeamsBtn = btns.createEl("button", { text: "Add Teams" });
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

			addTeamsBtn.addEventListener("click", () => {
				new CreateSubteamsModal(
					this.app,
					org.name,
					async (suffixes) => {
						try {
							await this.actions.addTeamsToExistingOrganization(
								org,
								org.name,
								suffixes
							);
							await this.actions.detectAndUpdateTeams();
							onRefreshUI();
							new Notice(
								`Added ${suffixes.length} team(s) to ${org.name}.`
							);
						} catch (e) {
							new Notice(`Failed to add team(s): ${e}`);
						}
					},
					{
						title: "Add Teams",
						addRowText: "Add Team",
						submitText: "Add Teams",
						emptyNoticeText: "Add at least one team.",
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
								getDisplayNameFromAlias(a.alias).localeCompare(
									getDisplayNameFromAlias(b.alias)
								)
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

	/**
	 * Render a team's members in a collapsible section.
	 * Sorted by classifyMember rank and then by display name.
	 */
	private renderTeamMembers(container: HTMLElement, t: TeamInfo) {
		container.empty();
		const raw = t.members ?? [];
		if (raw.length === 0) {
			container.createEl("em", { text: "No members yet." });
			return;
		}
		const sorted = raw.slice().sort((a, b) => {
			const ra = classifyMember(a).rank;
			const rb = classifyMember(b).rank;
			if (ra !== rb) return ra - rb;
			const an = getDisplayNameFromAlias(a.alias);
			const bn = getDisplayNameFromAlias(b.alias);
			return an.localeCompare(bn);
		});

		for (const m of sorted) {
			const line = container.createEl("div", {
				attr: {
					style: "display:flex; gap:8px; align-items:center; margin:3px 0;",
				},
			});
			const { label: typeLabel } = classifyMember(m);

			line.createEl("span", {
				text: getDisplayNameFromAlias(m.alias),
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

	/**
	 * Render org members list.
	 * Sorted by classifyMember rank and then by display name.
	 */
	private renderOrgMembers(container: HTMLElement, org: TeamInfo) {
		const members = (org.members ?? []).slice().sort((a, b) => {
			const ra = classifyMember(a).rank;
			const rb = classifyMember(b).rank;
			if (ra !== rb) return ra - rb;
			const an = getDisplayNameFromAlias(a.alias);
			const bn = getDisplayNameFromAlias(b.alias);
			return an.localeCompare(bn);
		});
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
				line.createEl("span", {
					text: getDisplayNameFromAlias(m.alias),
				});
				const { label: typeLabel } = classifyMember(m);
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
	}

	/**
	 * Render org teams and nested subteams with actions.
	 * Recursively renders subteam members and allows adding subteams/members.
	 */
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
				text: "Add Subteams",
			});
			const addMemberBtn = tBtns.createEl("button", {
				text: "Add Member",
			});

			const tContainer = container.createEl("div", {
				attr: {
					style: "margin:6px 0 8px 16px; display:none; border-left:2px solid var(--background-modifier-border); padding-left:10px;",
				},
			});

			const renderTeamDetails = () => {
				tContainer.empty();

				const listDirectSubteams = (parent: TeamInfo): TeamInfo[] => {
					const prefix =
						parent.rootPath.replace(/\/+$/g, "") + "/Teams/";
					return (this.settings.teams ?? [])
						.filter((st) => {
							const root = (st.rootPath || "").replace(
								/\/+$/g,
								""
							);
							if (!root.startsWith(prefix)) return false;
							const rest = root.slice(prefix.length);
							return rest.length > 0 && !rest.includes("/Teams/");
						})
						.sort((a, b) => a.name.localeCompare(b.name));
				};

				const renderNode = (
					node: TeamInfo,
					nodeContainer: HTMLElement
				) => {
					nodeContainer.empty();

					// Members
					const members = (node.members ?? [])
						.slice()
						.sort((a, b) => {
							const ra = classifyMember(a).rank;
							const rb = classifyMember(b).rank;
							if (ra !== rb) return ra - rb;
							const an = getDisplayNameFromAlias(a.alias);
							const bn = getDisplayNameFromAlias(b.alias);
							return an.localeCompare(bn);
						});
					nodeContainer.createEl("div", {
						text: "Members",
						attr: { style: "font-weight:600; margin-top:6px;" },
					});
					if (members.length === 0) {
						nodeContainer.createEl("em", {
							text: "No members yet.",
						});
					} else {
						for (const m of members) {
							const line = nodeContainer.createEl("div", {
								attr: {
									style: "display:flex; gap:8px; align-items:center; margin-top:4px;",
								},
							});
							line.createEl("span", {
								text: getDisplayNameFromAlias(m.alias),
							});
							const { label: typeLabel } = classifyMember(m);
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

					// Subteams (recursive)
					const subs = listDirectSubteams(node);
					nodeContainer.createEl("div", {
						text: "Subteams",
						attr: { style: "font-weight:600; margin-top:10px;" },
					});
					if (subs.length === 0) {
						nodeContainer.createEl("em", {
							text: "No subteams yet.",
						});
					} else {
						for (const st of subs) {
							const stRow = nodeContainer.createEl("div", {
								attr: {
									style: "display:flex; gap:8px; align-items:center; margin-top:4px;",
								},
							});
							stRow.createEl("span", { text: st.name });

							const stBtns = stRow.createEl("div", {
								attr: {
									style: "display:flex; gap:6px; align-items:center;",
								},
							});
							const stViewBtn = stBtns.createEl("button", {
								text: "View Members & Subteams",
							});
							const stCreateBtn = stBtns.createEl("button", {
								text: "Add Subteams",
							});
							const stAddMemberBtn = stBtns.createEl("button", {
								text: "Add Member",
							});

							const stContainer = nodeContainer.createEl("div", {
								attr: {
									style: "margin:6px 0 8px 16px; display:none; border-left:2px solid var(--background-modifier-border); padding-left:10px;",
								},
							});

							const renderStDetails = () => {
								renderNode(st, stContainer);
							};
							renderStDetails();

							stViewBtn.addEventListener("click", () => {
								stContainer.style.display =
									stContainer.style.display === "none"
										? "block"
										: "none";
							});

							stCreateBtn.addEventListener("click", () => {
								new CreateSubteamsModal(
									this.app,
									st.name,
									async (suffixes) => {
										try {
											await this.actions.createSubteams(
												st,
												suffixes
											);
											await this.actions.detectAndUpdateTeams();
											onRefreshUI();
											new Notice(
												`Created ${suffixes.length} subteam(s) under ${st.name}.`
											);
										} catch (e) {
											new Notice(
												`Failed to create subteams: ${e}`
											);
										}
									}
								).open();
							});
							stAddMemberBtn.addEventListener("click", () => {
								const {
									teamNames,
									internalTeamCodes,
									existingMembers,
								} = this.buildMemberSources();
								new AddMemberModal(
									this.app,
									st.name,
									teamNames,
									existingMembers,
									internalTeamCodes,
									async (memberName, memberAlias) => {
										const idx =
											this.settings.teams.findIndex(
												(x) =>
													x.name === st.name &&
													x.rootPath === st.rootPath
											);
										if (idx === -1) return;
										const teamRef =
											this.settings.teams[idx];
										teamRef.members = teamRef.members || [];
										if (
											!teamRef.members.find(
												(mm) => mm.alias === memberAlias
											)
										) {
											const lower =
												memberAlias.toLowerCase();
											const type: MemberInfo["type"] =
												lower.endsWith("-ext")
													? "external"
													: lower.endsWith("-team")
													? "team"
													: lower.endsWith("-int")
													? "internal-team-member"
													: "member";
											teamRef.members.push({
												alias: memberAlias,
												name: memberName,
												type,
											});
											teamRef.members.sort((a, b) =>
												getDisplayNameFromAlias(
													a.alias
												).localeCompare(
													getDisplayNameFromAlias(
														b.alias
													)
												)
											);
											await this.actions.saveSettings();
											renderStDetails();
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
				};

				renderNode(team, tContainer);
			};
			renderTeamDetails();

			viewBtn.addEventListener("click", () => {
				tContainer.style.display =
					tContainer.style.display === "none" ? "block" : "none";
			});

			addMemberBtn.addEventListener("click", () => {
				const { teamNames, internalTeamCodes, existingMembers } =
					this.buildMemberSources();
				new AddMemberModal(
					this.app,
					team.name,
					teamNames,
					existingMembers,
					internalTeamCodes,
					async (memberName, memberAlias) => {
						const idx = this.settings.teams.findIndex(
							(x) =>
								x.name === team.name &&
								x.rootPath === team.rootPath
						);
						if (idx === -1) return;
						const teamRef = this.settings.teams[idx];
						teamRef.members = teamRef.members || [];
						if (
							!teamRef.members.find(
								(mm) => mm.alias === memberAlias
							)
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
							teamRef.members.push({
								alias: memberAlias,
								name: memberName,
								type,
							});
							teamRef.members.sort((a, b) =>
								getDisplayNameFromAlias(a.alias).localeCompare(
									getDisplayNameFromAlias(b.alias)
								)
							);
							await this.actions.saveSettings();
							renderTeamDetails();
							onRefreshUI();
						} else {
							new Notice(
								"A member with the same alias already exists for this team."
							);
						}
					}
				).open();
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

	/**
	 * Build sources used by the "Add Member" modal:
	 * - teamNames: list of team display names
	 * - internalTeamCodes: map of internal team name -> inferred code (when alias ends in "-team")
	 * - existingMembers: unique list of 'member' kind (excludes external/team/internal-team-member)
	 */
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
				const kind = classifyMember(m).kind;
				if (kind !== "member") continue;
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
