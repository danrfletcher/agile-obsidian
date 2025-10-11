/**
 * Concrete Obsidian PluginSettingTab for Agile Obsidian Settings.
 * Construct via app factory instead of instantiating directly in composition.
 * Side-effects: Manipulates DOM, triggers actions and persists settings.
 */
import { App, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import type { AgileObsidianSettings } from "@settings";
import { TeamsPresenter, TeamsActions } from "../presenters/teams-presenter";
import { IdentityPresenter } from "../presenters/identity-presenter";
import { AddTeamModal } from "../modals/add-team-modal";

// Import the asset so the bundler emits a correct public URL.
import coffeeGifUrl from "../assets/coffee.gif";

export class AgileSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: Plugin,
		private settings: AgileObsidianSettings,
		private actions: TeamsActions,
		private saveSettings: () => Promise<void>,
		private applyCheckboxStylesSetting: () => Promise<void>
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Header row with title + coffee GIF link (fills remaining space)
		const headerRow = containerEl.createEl("div", {
			attr: {
				style: "display:flex; align-items:center; gap:12px; margin-bottom: 6px;",
			},
		});
		headerRow.createEl("h1", {
			text: "Agile Obsidian Settings",
			attr: { style: "margin: 0; flex: 0 0 auto;" },
		});

		const coffeeLink = headerRow.createEl("a", {
			href: "https://buymeacoffee.com/danrfletcher",
			attr: {
				target: "_blank",
				rel: "noopener noreferrer",
				style: "flex: 1 1 auto; display:flex; align-items:center; height: 36px; text-decoration: none;",
				"aria-label": "Buy me a coffee",
			},
		});
		coffeeLink.createEl("img", {
			attr: {
				src: coffeeGifUrl,
				alt: "Buy Me a Coffee",
				style: "width: 100%; height: 100%; object-fit: contain; object-position: right center; opacity: 0.95;",
			},
		});

		// ORG STRUCTURE SECTION (foldable)
		const org = this.createFoldableSection(
			containerEl,
			"Org Structure",
			"Discover and manage teams and organizations found in your vault. Add/update teams, create organizations, and manage subteams. Add Sample Team to see how it works.",
			this.settings.uiFoldOrgStructure,
			async (folded) => {
				this.settings.uiFoldOrgStructure = folded;
				await this.saveSettings();
			}
		);
		this.renderOrgStructureSection(org.contentEl);

		// AGILE DASHBOARD SECTION (foldable)
		const dash = this.createFoldableSection(
			containerEl,
			"Agile Dashboard View",
			"Choose which sections appear in the agile dashboard. Sections with no tasks are hidden by default.",
			this.settings.uiFoldAgileDashboard ?? true,
			async (folded) => {
				this.settings.uiFoldAgileDashboard = folded;
				await this.saveSettings();
			}
		);
		this.renderAgileDashboardSection(dash.contentEl);

		// UX SHORTCUTS SECTION (foldable)
		const ux = this.createFoldableSection(
			containerEl,
			"UX Shortcuts",
			"Turn ease of use features on/off.",
			this.settings.uiFoldUxShortcuts ?? true,
			async (folded) => {
				this.settings.uiFoldUxShortcuts = folded;
				await this.saveSettings();
			}
		);
		this.renderUxShortcutsSection(ux.contentEl);
	}

	private getTeamsCount(): number {
		return this.settings.teams?.length ?? 0;
	}

	/**
	 * Renders the Org Structure content into the provided container.
	 */
	private renderOrgStructureSection(containerEl: HTMLElement): void {
		containerEl.empty();

		const teamsButtons = new Setting(containerEl)
			.setName("List Members & Teams")
			.setDesc(
				"Detects teams and organizations from your vault and adds new teams."
			);

		// Determine whether a Sample Team already exists (case-insensitive match on team name).
		const hasSampleTeam =
			(this.settings.teams ?? []).some(
				(t) => (t.name || "").trim().toLowerCase() === "sample team"
			) || false;

		// Add Sample Team – neutral styling (first/left-most)
		teamsButtons.addButton((btn) => {
			btn.setButtonText("Add Sample Team")
				.setDisabled(hasSampleTeam)
				.onClick(() => {
					new AddTeamModal(
						this.app,
						this.settings.teamsFolder || "Teams",
						// onSubmit callback: pass seed flag to createTeam
						async (
							teamName,
							parentPath,
							teamSlug,
							code,
							_options
						) => {
							await this.actions.createTeam(
								teamName,
								parentPath,
								teamSlug,
								code,
								{ seedWithSampleData: true }
							);
							await this.actions.detectAndUpdateTeams();
							this.display();
							new Notice(`Sample Team added.`);
						},
						{
							presetName: "Sample Team",
							disableNameInput: true,
							submitLabel: "Add Sample Team",
							seedWithSampleData: true,
						}
					).open();
				});
			return btn;
		});

		// Update Teams – keep primary styling
		teamsButtons.addButton((btn) =>
			btn
				.setButtonText("Update Teams")
				.setCta()
				.onClick(async () => {
					await this.actions.detectAndUpdateTeams();
					this.display();
					new Notice(`Detected ${this.getTeamsCount()} team(s).`);
				})
		);

		// Add Team – neutral styling
		teamsButtons.addButton((btn) =>
			btn.setButtonText("Add Team").onClick(() => {
				new AddTeamModal(
					this.app,
					this.settings.teamsFolder || "Teams",
					async (teamName, parentPath, teamSlug, code, _options) => {
						await this.actions.createTeam(
							teamName,
							parentPath,
							teamSlug,
							code
						);
						await this.actions.detectAndUpdateTeams();
						this.display();
						new Notice(`Team "${teamName}" added.`);
					}
				).open();
			})
		);

		const teamsListContainer = containerEl.createEl("div");
		const identityContainer = containerEl.createEl("div", {
			attr: { style: "padding-top: 12px;" },
		});

		const presenter = new TeamsPresenter(
			this.app,
			this.settings,
			this.actions
		);
		presenter.mount(teamsListContainer, identityContainer, () =>
			this.display()
		);

		const identityPresenter = new IdentityPresenter(
			this.settings,
			this.saveSettings
		);
		identityPresenter.mount(identityContainer);
	}

	/**
	 * Renders the Agile Dashboard content into the provided container.
	 */
	private renderAgileDashboardSection(containerEl: HTMLElement): void {
		containerEl.empty();

		new Setting(containerEl)
			.setName("Toggle Sections")
			.setDesc(
				"Select which sections to display in project view. Sections with no tasks are hidden by default."
			)
			.setClass("setting-item-description");

		new Setting(containerEl)
			.setName("🎯 Objectives (OKRs)")
			.addToggle((toggle) =>
				toggle
					.setValue(this.settings.showObjectives)
					.onChange(async (value) => {
						this.settings.showObjectives = value;
						await this.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("🧹 Responsibilities")
			.addToggle((toggle) =>
				toggle
					.setValue(this.settings.showResponsibilities)
					.onChange(async (value) => {
						this.settings.showResponsibilities = value;
						await this.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("🔨 Tasks (Subtasks)")
			.addToggle((toggle) =>
				toggle
					.setValue(this.settings.showTasks)
					.onChange(async (value) => {
						this.settings.showTasks = value;
						await this.saveSettings();
					})
			);

		new Setting(containerEl).setName("📝 Stories").addToggle((toggle) =>
			toggle
				.setValue(this.settings.showStories)
				.onChange(async (value) => {
					this.settings.showStories = value;
					await this.saveSettings();
				})
		);

		new Setting(containerEl).setName("🏆 Epics").addToggle((toggle) =>
			toggle.setValue(this.settings.showEpics).onChange(async (value) => {
				this.settings.showEpics = value;
				await this.saveSettings();
			})
		);

		new Setting(containerEl).setName("🎖️ Initiatives").addToggle((toggle) =>
			toggle
				.setValue(this.settings.showInitiatives)
				.onChange(async (value) => {
					this.settings.showInitiatives = value;
					await this.saveSettings();
				})
		);

		new Setting(containerEl).setName("📁 Priorities").addToggle((toggle) =>
			toggle
				.setValue(this.settings.showPriorities)
				.onChange(async (value) => {
					this.settings.showPriorities = value;
					await this.saveSettings();
				})
		);
	}

	/**
	 * Renders the UX Shortcuts content into the provided container.
	 */
	private renderUxShortcutsSection(containerEl: HTMLElement): void {
		containerEl.empty();

		// Subheader + description
		new Setting(containerEl)
			.setName("Agile Artifact Templates")
			.setDesc(
				"Applies to tasks containing Initiatives, Epics, User Stories & other agile templates"
			);

		// Toggle: Multiple Agile Template Easy Insertion
		new Setting(containerEl)
			.setName("Multiple Agile Template Easy Insertion")
			.setDesc(
				"With your cursor at the end of a task line containing an agile artifact template (Initiative, Epic, User Story etc), double press enter to quickly create the same artifact on the next line."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.settings.enableUxRepeatAgileTemplates)
					.onChange(async (value) => {
						this.settings.enableUxRepeatAgileTemplates = value;
						// Persist and take effect immediately; the handler checks this flag live.
						await this.saveSettings();
					})
			);
	}

	/**
	 * Creates a foldable section with a header and description.
	 * Returns the created elements so the caller can render content into `contentEl`.
	 * - No explicit toggle button; the caret/title/description header is clickable.
	 * - Description expands to fill the space (min-width:0 enables wrapping within flex).
	 */
	private createFoldableSection(
		parent: HTMLElement,
		title: string,
		description: string,
		initialFolded: boolean,
		onTogglePersist: (folded: boolean) => Promise<void>
	): { headerEl: HTMLElement; contentEl: HTMLElement } {
		const section = parent.createEl("div", {
			attr: {
				style: "border: 1px solid var(--background-modifier-border); border-radius: 8px; margin: 12px 0; overflow: hidden;",
			},
		});

		const header = section.createEl("div", {
			attr: {
				style: "display:flex; align-items:flex-start; gap:10px; padding:10px; cursor:pointer; background: var(--background-secondary);",
			},
		});

		const caret = header.createEl("div", {
			text: initialFolded ? "▶" : "▼",
			attr: {
				style: "width: 18px; flex: 0 0 18px; line-height:18px; text-align:center; user-select:none;",
			},
		});

		// Titles container fills remaining width; min-width:0 ensures text wraps instead of overflowing in flex.
		const titles = header.createEl("div", {
			attr: { style: "flex:1 1 auto; min-width:0;" },
		});
		titles.createEl("div", {
			text: title,
			attr: { style: "font-weight:600; font-size:14px;" },
		});
		titles.createEl("div", {
			text: description,
			attr: {
				style: "color: var(--text-muted); margin-top:2px; line-height: 1.4;",
			},
		});

		const content = section.createEl("div", {
			attr: { style: "padding: 10px;" },
		});

		const applyFold = (folded: boolean) => {
			content.style.display = folded ? "none" : "block";
			caret.textContent = folded ? "▶" : "▼";
		};

		applyFold(initialFolded);

		const toggle = async () => {
			const folded = content.style.display !== "none" ? true : false;
			applyFold(folded);
			try {
				await onTogglePersist(folded);
			} catch {
				// ignore save errors here; UI already reflects the choice
			}
		};

		// Entire header toggles (caret, title, description)
		header.addEventListener("click", () => void toggle());

		return { headerEl: header, contentEl: content };
	}
}
