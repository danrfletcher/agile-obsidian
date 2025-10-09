/**
 * Modal for adding a new team under a selected parent path.
 * Side-effects: Manipulates DOM, calls onSubmit to create the team upstream.
 */
import { App, Modal, Notice, TFolder } from "obsidian";
import { buildTeamSlug } from "@features/org-structure";

export type AddTeamModalOptions = Partial<{
	presetName: string;
	disableNameInput: boolean;
	submitLabel: string;
	seedWithSampleData: boolean; // passed through to onSubmit options
}>;

export class AddTeamModal extends Modal {
	constructor(
		app: App,
		private defaultParentPath: string | undefined,
		private onSubmit: (
			teamName: string,
			parentPath: string,
			teamSlug: string,
			code: string,
			options?: { seedWithSampleData?: boolean }
		) => Promise<void> | void,
		private options?: AddTeamModalOptions
	) {
		super(app);
	}

	/**
	 * Render the modal content and wire handlers.
	 * Shows a folder picker from all loaded vault folders.
	 */
	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		const submitLabel = this.options?.submitLabel || "Add Team";
		const presetName = (this.options?.presetName || "").trim();
		const disableName = !!this.options?.disableNameInput;

		contentEl.createEl("h3", { text: "Add Team" });

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
		if (presetName) nameInput.value = presetName;
		if (disableName) {
			nameInput.readOnly = true;
			nameInput.disabled = true;
			nameInput.style.opacity = "0.7";
		}

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
		selectEl.value = this.defaultParentPath ?? "/";

		const code = this.generateCode();

		const aliasPreview = contentEl.createEl("div", {
			attr: { style: "margin-top: 8px; color: var(--text-muted);" },
		});
		aliasPreview.createEl("div", {
			text: "Alias (auto-generated)",
		}).style.fontWeight = "600";
		const aliasValue = aliasPreview.createEl("code", { text: "" });
		const updateAlias = () => {
			const teamName =
				(nameInput.value.trim() || "sample") + (disableName ? "" : "");
			aliasValue.textContent = buildTeamSlug(teamName, code, null as any);
		};
		nameInput.addEventListener("input", updateAlias);
		updateAlias();

		const btns = contentEl.createEl("div", {
			attr: {
				style: "display:flex; gap:8px; justify-content:flex-end; margin-top: 16px;",
			},
		});
		const cancelBtn = btns.createEl("button", { text: "Cancel" });
		cancelBtn.addEventListener("click", () => this.close());
		const addBtn = btns.createEl("button", { text: submitLabel });
		addBtn.addEventListener("click", async () => {
			const teamName = nameInput.value.trim();
			const parentPath = selectEl.value;
			if (!teamName) {
				new Notice("Please enter a team name.");
				return;
			}
			const slug = buildTeamSlug(teamName, code, null as any);
			await this.onSubmit(teamName, parentPath, slug, code, {
				seedWithSampleData: !!this.options?.seedWithSampleData,
			});
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
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
}
