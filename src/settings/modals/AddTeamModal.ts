import { App, Modal, Notice, TFolder } from "obsidian";
import {
	generateShortCode,
	buildTeamSlug,
} from "../../utils/commands/commandUtils";

export class AddTeamModal extends Modal {
	constructor(
		app: App,
		private defaultParentPath: string | undefined,
		private onSubmit: (
			teamName: string,
			parentPath: string,
			teamSlug: string,
			code: string
		) => Promise<void> | void
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
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

		// Parent folder selection (default to vault root)
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
		// Default to vault root regardless of configured default path
		selectEl.value = "/";

		const code = generateShortCode();
		const aliasPreview = contentEl.createEl("div", {
			attr: { style: "margin-top: 8px; color: var(--text-muted);" },
		});
		aliasPreview.createEl("div", {
			text: "Alias (auto-generated)",
		}).style.fontWeight = "600";
		const aliasValue = aliasPreview.createEl("code", { text: "" });
		const updateAlias = () => {
			const teamName = nameInput.value.trim() || "sample";
			aliasValue.textContent = buildTeamSlug(teamName, code, null);
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
		const addBtn = btns.createEl("button", { text: "Add Team" });
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
