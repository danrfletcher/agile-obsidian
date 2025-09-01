/**
 * Modal for creating subteams under a given parent team.
 * Side-effects: Manipulates DOM, calls onSubmit to persist changes upstream.
 */
import { App, Modal, Notice } from "obsidian";

export class CreateSubteamsModal extends Modal {
	private parentTeamName: string;
	private onSubmit: (suffixes: string[]) => void | Promise<void>;
	private ui: {
		title: string;
		addRowText: string;
		submitText: string;
		emptyNoticeText: string;
	};

	constructor(
		app: App,
		parentTeamName: string,
		onSubmit: (suffixes: string[]) => void | Promise<void>,
		uiOverrides?: Partial<{
			title: string;
			addRowText: string;
			submitText: string;
			emptyNoticeText: string;
		}>
	) {
		super(app);
		this.parentTeamName = parentTeamName;
		this.onSubmit = onSubmit;
		this.ui = Object.assign(
			{
				title: "Add Subteams",
				addRowText: "Add Subteam",
				submitText: "Create Subteams",
				emptyNoticeText: "Add at least one subteam.",
			},
			uiOverrides || {}
		);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl("h3", { text: this.ui.title });

		const info = contentEl.createEl("div", {
			attr: { style: "margin-bottom: 8px; color: var(--text-muted);" },
		});
		info.setText(`Parent team: ${this.parentTeamName}`);

		const listWrap = contentEl.createEl("div");
		const addBtnWrap = contentEl.createEl("div", {
			attr: { style: "margin-top: 6px;" },
		});
		const addTeamBtn = addBtnWrap.createEl("button", {
			text: this.ui.addRowText,
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
		const create = btns.createEl("button", { text: this.ui.submitText });
		create.addEventListener("click", async () => {
			const suffixes = rows
				.map((r) => r.suffixInput.value.trim())
				.filter(Boolean);
			if (suffixes.length === 0) {
				new Notice(this.ui.emptyNoticeText);
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
