/**
 * Modal to add a member/internal team/external delegate to a team or org.
 * Side-effects: Manipulates DOM, calls onSubmit to persist changes upstream.
 */
import { App, Modal, Notice } from "obsidian";
import type { MemberInfo } from "@features/org-structure";

export type AddMemberKind =
	| "member"
	| "external"
	| "team"
	| "internal-team-member";

export type AddMemberModalOptions = {
	/**
	 * Override button text (e.g. "Assign to new member", "Delegate to new member").
	 */
	submitButtonText?: string;
	/**
	 * Limit which kinds the user can pick. Defaults to all if not provided.
	 * Values: "member" (Team member), "external" (External delegate),
	 *         "team" (Internal team), "existing" (Existing member with role dropdown).
	 */
	allowedTypes?: Array<"member" | "external" | "team" | "existing">;
	/**
	 * Optional custom title for the modal header.
	 */
	titleText?: string;
};

function setSectionVisible(element: HTMLElement, visible: boolean): void {
	element.classList.toggle("is-hidden", !visible);
}

export class AddMemberModal extends Modal {
	private onSubmit: (
		memberName: string,
		memberAlias: string,
		selectedKind: AddMemberKind
	) => void | Promise<void>;
	private teamName: string;
	private allTeams: string[];
	private existingMembers: MemberInfo[];
	private internalTeamCodes: Map<string, string>;
	private options?: AddMemberModalOptions;

	constructor(
		app: App,
		teamName: string,
		allTeams: string[],
		existingMembers: MemberInfo[],
		internalTeamCodes: Map<string, string>,
		onSubmit: (
			memberName: string,
			memberAlias: string,
			selectedKind: AddMemberKind
		) => void | Promise<void>,
		options?: AddMemberModalOptions
	) {
		super(app);
		this.onSubmit = onSubmit;
		this.teamName = teamName;
		this.allTeams = allTeams;
		this.existingMembers = existingMembers;
		this.internalTeamCodes = internalTeamCodes;
		this.options = options;
	}

	/**
	 * Generates a 6-char code matching /^[0-9][a-z0-9]{5}$/ (lowercased).
	 */
	private generateCode(): string {
		const first = Math.floor(Math.random() * 10).toString(); // 0-9
		const rest = Array.from({ length: 5 })
			.map(() => Math.floor(Math.random() * 36).toString(36))
			.join("");
		return (first + rest).toLowerCase();
	}

	/**
	 * Build a member alias from a human name, code and external flag.
	 * - Doubles literal hyphens to differentiate from space replacements.
	 * - Replaces whitespace with single hyphens.
	 * - Appends "-ext" for external delegates.
	 * Example: "Dan — Fletcher", code "1ab2cd" -> "dan-fletcher-1ab2cd" (or "-ext").
	 */
	private nameToAlias(
		name: string,
		code: string,
		isExternal: boolean
	): string {
		let base = (name || "").trim().toLowerCase();
		base = base
			.replace(/-/g, "--")
			.replace(/\s+/g, "-")
			.replace(/[^a-z0-9-]/g, "");
		return `${base}-${code}${isExternal ? "-ext" : ""}`;
	}

	/**
	 * Build an internal team alias from a team name and code, suffixed with "-team".
	 */
	private teamAlias(name: string, code: string): string {
		let base = (name || "").trim().toLowerCase();
		base = base
			.replace(/-/g, "--")
			.replace(/\s+/g, "-")
			.replace(/[^a-z0-9-]/g, "");
		return `${base}-${code}-team`;
	}

	/**
	 * Render the modal content and wire handlers.
	 */
	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		const code = this.generateCode();

		contentEl.createEl("h3", {
			text:
				this.options?.titleText ??
				`Add member to ${this.teamName || "Team"}`,
		});

		const allowedTypes =
			this.options?.allowedTypes ??
			(["member", "external", "team", "existing"] as const);

		const typeWrapper = contentEl.createEl("div", {
			attr: { style: "margin-bottom: 8px;" },
		});
		typeWrapper.createEl("label", {
			text: "Member type",
			attr: { style: "display:block; margin-bottom:4px;" },
		});
		const typeSelect: HTMLSelectElement = typeWrapper.createEl("select", {
			attr: { style: "width: 100%;" },
		});

		const addOpt = (value: string, text: string) => {
			typeSelect.createEl("option", {
				text,
				attr: { value },
			});
		};

		if (allowedTypes.includes("member")) addOpt("member", "Team member");
		if (allowedTypes.includes("external"))
			addOpt("external", "External delegate");
		if (allowedTypes.includes("team")) addOpt("team", "Internal team");
		if (allowedTypes.includes("existing"))
			addOpt("existing", "Existing member");

		// If nothing was added (defensive), default to "member"
		if (typeSelect.options.length === 0) addOpt("member", "Team member");

		typeSelect.value = typeSelect.options[0].value;
		let isExternal = typeSelect.value === "external";
		let isInternal = typeSelect.value === "team";
		let isExisting = typeSelect.value === "existing";

		const nameWrapper = contentEl.createEl("div", {
			attr: { style: "margin-bottom: 12px;" },
		});
		nameWrapper.createEl("label", {
			text: "Member name",
			attr: { style: "display:block; margin-bottom:4px;" },
		});
		const nameInput: HTMLInputElement = nameWrapper.createEl("input", {
			type: "text",
			attr: {
				placeholder: "For example, team member name",
				style: "width: 100%;",
			},
		});

		const teamWrapper = contentEl.createEl("div", {
			attr: { style: "margin-bottom: 12px;" },
			cls: "is-hidden",
		});
		teamWrapper.createEl("label", {
			text: "Select team",
			attr: { style: "display:block; margin-bottom:4px;" },
		});
		const teamSelect: HTMLSelectElement = teamWrapper.createEl("select", {
			attr: { style: "width: 100%;" },
		});
		for (const tn of this.allTeams) {
			teamSelect.createEl("option", {
				text: tn,
				attr: { value: tn },
			});
		}

		const existingWrapper = contentEl.createEl("div", {
			attr: { style: "margin-bottom: 12px;" },
			cls: "is-hidden",
		});
		existingWrapper.createEl("label", {
			text: "Select existing member",
			attr: { style: "display:block; margin-bottom:4px;" },
		});
		const existingSelect: HTMLSelectElement =
			existingWrapper.createEl("select", {
				attr: { style: "width: 100%;" },
			});
		for (const m of this.existingMembers ?? []) {
			const alias = m.alias ?? "";
			existingSelect.createEl("option", {
				text: `${m.name} (${alias})`,
				attr: { value: alias },
			});
		}

		const roleWrapper = contentEl.createEl("div", {
			attr: { style: "margin-bottom: 12px;" },
			cls: "is-hidden",
		});
		roleWrapper.createEl("label", {
			text: "Existing member role",
			attr: { style: "display:block; margin-bottom:4px;" },
		});
		const roleSelect: HTMLSelectElement = roleWrapper.createEl("select", {
			attr: { style: "width: 100%;" },
		});
		roleSelect.createEl("option", {
			text: "Team member",
			attr: { value: "member" },
		});
		roleSelect.createEl("option", {
			text: "Internal team member",
			attr: { value: "internal-team-member" },
		});
		roleSelect.value = "member";

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

			setSectionVisible(nameWrapper, !isInternal && !isExisting);
			setSectionVisible(teamWrapper, isInternal && this.allTeams.length > 0);
			setSectionVisible(existingWrapper, isExisting);
			setSectionVisible(roleWrapper, isExisting);

			updateAlias();
		});

		nameInput.addEventListener("input", updateAlias);
		teamSelect.addEventListener("change", updateAlias);
		existingSelect.addEventListener("change", updateAlias);
		roleSelect.addEventListener("change", updateAlias);
		updateAlias();

		const buttons = contentEl.createEl("div", {
			attr: {
				style: "display:flex; gap: 8px; justify-content: flex-end; margin-top: 16px;",
			},
		});

		const cancelBtn = buttons.createEl("button", { text: "Cancel" });
		cancelBtn.addEventListener("click", () => this.close());

		const addBtn = buttons.createEl("button", {
			text: this.options?.submitButtonText ?? "Add member",
		});
		addBtn.addEventListener("click", () => {
			void (async () => {
				let memberName: string;
				let memberAlias: string;
				let selectedKind: AddMemberKind;

				if (isInternal) {
					// Internal team
					memberName = (teamSelect.value || "").trim();
					if (!memberName) {
						new Notice("Please select a team.");
						return;
					}
					const codeToUse =
						this.internalTeamCodes.get(memberName) ?? code;
					memberAlias = this.teamAlias(memberName, codeToUse);
					selectedKind = "team";
				} else if (isExisting) {
					// Existing -> pick role
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
						memberAlias = selectedAlias
							.toLowerCase()
							.endsWith("-int")
							? selectedAlias
							: `${selectedAlias}-int`;
						selectedKind = "internal-team-member";
					} else {
						memberAlias = selectedAlias;
						selectedKind = "member";
					}
				} else {
					// New person
					memberName = nameInput.value.trim();
					if (!memberName) {
						new Notice("Please enter a member name.");
						return;
					}
					memberAlias = this.nameToAlias(
						memberName,
						code,
						isExternal
					);
					selectedKind = isExternal ? "external" : "member";
				}

				await this.onSubmit(memberName, memberAlias, selectedKind);
				this.close();
			})();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}