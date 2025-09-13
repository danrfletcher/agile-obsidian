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
	 * Override button text (e.g. "Assign to New Member", "Delegate to New Member").
	 */
	submitButtonText?: string;
	/**
	 * Limit which kinds the user can pick. Defaults to all if not provided.
	 * Values: "member" (Team Member), "external" (External Delegate),
	 *         "team" (Internal Team), "existing" (Existing Member with role dropdown).
	 */
	allowedTypes?: Array<"member" | "external" | "team" | "existing">;
	/**
	 * Optional custom title for the modal header.
	 */
	titleText?: string;
};

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
				`Add Member to ${this.teamName || "Team"}`,
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
		const typeSelect = typeWrapper.createEl("select", {
			attr: { style: "width: 100%;" },
		}) as HTMLSelectElement;

		const addOpt = (value: string, text: string) => {
			const opt = document.createElement("option");
			opt.value = value;
			opt.text = text;
			typeSelect.appendChild(opt);
		};

		if (allowedTypes.includes("member")) addOpt("member", "Team Member");
		if (allowedTypes.includes("external"))
			addOpt("external", "External Delegate");
		if (allowedTypes.includes("team")) addOpt("team", "Internal Team");
		if (allowedTypes.includes("existing"))
			addOpt("existing", "Existing Member");

		// If nothing was added (defensive), default to "member"
		if (typeSelect.options.length === 0) addOpt("member", "Team Member");

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
		const nameInput = nameWrapper.createEl("input", {
			type: "text",
			attr: { placeholder: "e.g., Dan Fletcher", style: "width: 100%;" },
		}) as HTMLInputElement;

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

			// Toggle UI blocks
			nameWrapper.style.display =
				!isInternal && !isExisting ? "" : "none";
			teamWrapper.style.display = isInternal ? "" : "none";
			existingWrapper.style.display = isExisting ? "" : "none";
			roleWrapper.style.display = isExisting ? "" : "none";

			// If Internal Team option is allowed but no teams are available, hide the selector block
			if (isInternal && this.allTeams.length === 0) {
				teamWrapper.style.display = "none";
			}

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
			text: this.options?.submitButtonText ?? "Add Member",
		});
		addBtn.addEventListener("click", async () => {
			let memberName: string;
			let memberAlias: string;
			let selectedKind: AddMemberKind;

			if (isInternal) {
				// Internal Team
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
					memberAlias = selectedAlias.toLowerCase().endsWith("-int")
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
				memberAlias = this.nameToAlias(memberName, code, isExternal);
				selectedKind = isExternal ? "external" : "member";
			}

			await this.onSubmit(memberName, memberAlias, selectedKind);
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
