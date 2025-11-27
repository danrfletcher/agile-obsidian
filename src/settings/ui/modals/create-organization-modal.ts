/**
 * Modal for creating an organization from an existing team with one or more child teams.
 * Side-effects: Manipulates DOM, calls onSubmit to persist changes upstream.
 */
import { App, Modal, Notice } from "obsidian";

export class CreateOrganizationModal extends Modal {
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

		contentEl.createEl("h3", { text: "Create organization from team" });

		// Org name input
		const nameWrap = contentEl.createEl("div", {
			attr: { style: "margin-bottom: 12px;" },
		});
		nameWrap.createEl("label", {
			text: "Organization name",
			attr: { style: "display:block; margin-bottom:4px;" },
		});
		const orgNameInput = nameWrap.createEl("input", {
			type: "text",
			attr: { style: "width:100%;" },
		});
		orgNameInput.value = this.initialOrgName;

		// Teams list
		const listWrap = contentEl.createEl("div");
		const addBtnWrap = contentEl.createEl("div", {
			attr: { style: "margin-top: 6px;" },
		});
		const addTeamBtn = addBtnWrap.createEl("button", {
			text: "Add another team",
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
			});

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
		const create = btns.createEl("button", {
			text: "Create organization",
		});
		create.addEventListener("click", () => {
			void (async () => {
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
			})();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}