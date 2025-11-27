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

		// Ensure our settings-specific styles are present once.
		this.ensureAgileSettingsStyles();

		// Header row using a Setting heading with a coffee link on the right
		const headerSetting = new Setting(containerEl)
			.setName("Agile Obsidian")
			.setHeading();

		const headerControlEl = headerSetting.controlEl;
		headerControlEl.empty();

		const coffeeLink = headerControlEl.createEl("a", {
			href: "https://buymeacoffee.com/danrfletcher",
			attr: {
				target: "_blank",
				rel: "noopener noreferrer",
				style: "display:flex; align-items:center; height: 36px; text-decoration: none;",
				"aria-label": "Buy me a coffee",
			},
		});
		coffeeLink.createEl("img", {
			attr: {
				src: coffeeGifUrl,
				alt: "Buy me a coffee",
				style: "width: 100%; height: 100%; object-fit: contain; object-position: right center; opacity: 0.95;",
			},
		});

		// ORG STRUCTURE SECTION (foldable)
		const org = this.createFoldableSection(
			containerEl,
			"Org structure",
			"Discover and manage teams and organizations found in your vault. Add or update teams, create organizations, and manage subteams. Add a sample team to see how it works.",
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
			"Agile dashboard view",
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
			"UX shortcuts",
			"Turn ease-of-use features on or off.",
			this.settings.uiFoldUxShortcuts ?? true,
			async (folded) => {
				this.settings.uiFoldUxShortcuts = folded;
				await this.saveSettings();
			}
		);
		this.renderUxShortcutsSection(ux.contentEl);

		// STYLES SECTION (foldable)
		const styles = this.createFoldableSection(
			containerEl,
			"Styles",
			"Enable or disable Agile Obsidian's bundled checkbox styling.",
			this.settings.uiFoldStyles ?? true,
			async (folded) => {
				this.settings.uiFoldStyles = folded;
				await this.saveSettings();
			}
		);
		this.renderStylesSection(styles.contentEl);

		// AGILE TASK FORMATTING SECTION (foldable)
		const fmt = this.createFoldableSection(
			containerEl,
			"Agile task formatting",
			"Automatically keeps task lines clean and consistent. This section controls the canonical formatter and related task formatting actions.",
			this.settings.uiFoldAgileTaskFormatting ?? true,
			async (folded) => {
				this.settings.uiFoldAgileTaskFormatting = folded;
				await this.saveSettings();
			}
		);
		this.renderAgileTaskFormattingSection(fmt.contentEl);
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
			.setName("List members and teams")
			.setDesc(
				"Detects teams and organizations from your vault and adds new teams."
			);

		// Determine whether a sample team already exists (case-insensitive match on team name).
		const hasSampleTeam =
			(this.settings.teams ?? []).some(
				(t) => (t.name || "").trim().toLowerCase() === "sample team"
			) || false;

		// Add sample team – neutral styling (first/left-most)
		teamsButtons.addButton((btn) => {
			btn.setButtonText("Add sample team")
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
								code
							);
							await this.actions.detectAndUpdateTeams();
							this.display();
							new Notice("Sample team added.");
						},
						{
							presetName: "Sample team",
							disableNameInput: true,
							submitLabel: "Add sample team",
							seedWithSampleData: true,
						}
					).open();
				});
			return btn;
		});

		// Update teams – keep primary styling
		teamsButtons.addButton((btn) =>
			btn
				.setButtonText("Update teams")
				.setCta()
				.onClick(async () => {
					await this.actions.detectAndUpdateTeams();
					this.display();
					new Notice(`Detected ${this.getTeamsCount()} team(s).`);
				})
		);

		// Add team – neutral styling
		teamsButtons.addButton((btn) =>
			btn.setButtonText("Add team").onClick(() => {
				new AddTeamModal(
					this.app,
					this.settings.teamsFolder || "Teams",
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
			.setName("Toggle sections")
			.setDesc(
				"Select which sections to display in project view. Sections with no tasks are hidden by default."
			)
			.setClass("setting-item-description");

		new Setting(containerEl)
			// eslint-disable-next-line obsidianmd/ui/sentence-case
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
			// eslint-disable-next-line obsidianmd/ui/sentence-case
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
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setName("🔨 Tasks (subtasks)")
			.addToggle((toggle) =>
				toggle
					.setValue(this.settings.showTasks)
					.onChange(async (value) => {
						this.settings.showTasks = value;
						await this.saveSettings();
					})
			);
		// eslint-disable-next-line obsidianmd/ui/sentence-case
		new Setting(containerEl).setName("📝 Stories").addToggle((toggle) =>
			toggle
				.setValue(this.settings.showStories)
				.onChange(async (value) => {
					this.settings.showStories = value;
					await this.saveSettings();
				})
		);
		// eslint-disable-next-line obsidianmd/ui/sentence-case
		new Setting(containerEl).setName("🏆 Epics").addToggle((toggle) =>
			toggle.setValue(this.settings.showEpics).onChange(async (value) => {
				this.settings.showEpics = value;
				await this.saveSettings();
			})
		);
		// eslint-disable-next-line obsidianmd/ui/sentence-case
		new Setting(containerEl).setName("🎖️ Initiatives").addToggle((toggle) =>
			toggle
				.setValue(this.settings.showInitiatives)
				.onChange(async (value) => {
					this.settings.showInitiatives = value;
					await this.saveSettings();
				})
		);
		// eslint-disable-next-line obsidianmd/ui/sentence-case
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
			.setName("Agile artifact templates")
			.setDesc(
				"Applies to tasks containing initiatives, epics, user stories, and other agile templates."
			);

		// Toggle: Multiple Agile Template Easy Insertion
		new Setting(containerEl)
			.setName("Multiple agile template easy insertion")
			.setDesc(
				"With your cursor at the end of a task line containing an agile artifact template (initiative, epic, user story, etc.), double press enter to quickly create the same artifact on the next line."
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
	 * Renders the Styles content into the provided container.
	 * Provides a toggle for the bundled custom checkbox CSS.
	 */
	private renderStylesSection(containerEl: HTMLElement): void {
		containerEl.empty();

		new Setting(containerEl)
			.setName("Task & checkbox styles")
			.setDesc(
				// eslint-disable-next-line obsidianmd/ui/sentence-case
				"Enable Agile Obsidian's bundled styles for tasks. Turn this off if your theme or another plugin provides its own custom checkbox or task styling."
			)	
			.addToggle((toggle) =>
				toggle
					.setValue(this.settings.useBundledCheckboxes)
					.onChange(async (value) => {
						this.settings.useBundledCheckboxes = value;
						await this.saveSettings();
						await this.applyCheckboxStylesSetting();
					})
			);
	}

	/**
	 * Renders the Agile Task Formatting content into the provided container.
	 * - Adds visual "disabled" styling to subordinate toggles when the master is off.
	 */
	private renderAgileTaskFormattingSection(
		containerEl: HTMLElement
	): void {
		containerEl.empty();

		// Section subheader inside the fold
		new Setting(containerEl)
			.setName("Canonical formatting")
			.setDesc(
				"Settings related to the canonical formatter, which keeps each task line in a clean, consistent structure."
			);

		// Master toggle
		new Setting(containerEl)
			.setName("Enable canonical task formatter")
			.setDesc(
				"Turns on automatic task canonicalization. Disables all related triggers when off."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.settings.enableTaskCanonicalFormatter)
					.onChange(async (value) => {
						this.settings.enableTaskCanonicalFormatter = value;
						await this.saveSettings();
						// Re-render to update disabled state + color of child toggles immediately
						this.display();
					})
			);

		const masterEnabled = !!this.settings.enableTaskCanonicalFormatter;

		// Toggle 2: Run on Line Commit
		const lineCommitSetting = new Setting(containerEl)
			.setName("Run on line commit")
			.setDesc("Auto format task line when you move to a new task.");
		lineCommitSetting.addToggle((toggle) => {
			toggle.setValue(this.settings.enableCanonicalOnLineCommit);
			toggle.setDisabled(!masterEnabled);
			toggle.onChange(async (value) => {
				this.settings.enableCanonicalOnLineCommit = value;
				await this.saveSettings();
			});
		});
		this.applySubToggleDisabledStyle(lineCommitSetting, !masterEnabled);

		// Toggle 3: Run on Leaf Change
		const leafChangeSetting = new Setting(containerEl)
			.setName("Run on leaf change")
			.setDesc("Auto format file when the active note changes.");
		leafChangeSetting.addToggle((toggle) => {
			toggle.setValue(this.settings.enableCanonicalOnLeafChange);
			toggle.setDisabled(!masterEnabled);
			toggle.onChange(async (value) => {
				this.settings.enableCanonicalOnLeafChange = value;
				await this.saveSettings();
			});
		});
		this.applySubToggleDisabledStyle(leafChangeSetting, !masterEnabled);

		// Button: Format All Files in Vault
		new Setting(containerEl)
			.setName("Run on all files in vault")
			.setDesc(
				"Run the canonical formatter across every Markdown file in your vault now."
			)
			.addButton((btn) =>
				btn
					.setCta()
					.setButtonText("Run canonical formatter")
					.onClick(async () => {
						try {
							// @ts-ignore
							this.app.workspace.trigger(
								"agile-canonical-format-all"
							);
							new Notice("Started formatting all files…");
						} catch {
							new Notice(
								"Could not start formatting. Please try again."
							);
						}
					})
			);

		// =========================
		// Metadata Cleanup subsection
		// =========================
		new Setting(containerEl)
			.setName("Metadata cleanup")
			.setDesc(
				"Settings relating to the metadata cleanup feature, which removes deprecated and expired metadata from tasks."
			);

		// Master toggle: Enable Metadata Cleanup
		const mcMaster = new Setting(containerEl)
			.setName("Enable metadata cleanup")
			.setDesc(
				"Turns on automatic metadata cleanup. When off, scheduled cleanup does not run."
			);
		mcMaster.addToggle((toggle) => {
			toggle.setValue(this.settings.enableMetadataCleanup ?? true);
			toggle.onChange(async (value) => {
				this.settings.enableMetadataCleanup = value;
				await this.saveSettings();
				// Re-render to reflect disabled state of child toggles
				this.display();
			});
		});
		const mcEnabled = !!this.settings.enableMetadataCleanup;

		// Subtoggle: Run On Obsidian Start
		const mcOnStart = new Setting(containerEl)
			.setName("Run on Obsidian start")
			.setDesc(
				"Runs a cleanup pass automatically when Obsidian starts (or the plugin loads)."
			);
		mcOnStart.addToggle((toggle) => {
			toggle.setValue(this.settings.enableMetadataCleanupOnStart ?? true);
			toggle.setDisabled(!mcEnabled);
			toggle.onChange(async (value) => {
				this.settings.enableMetadataCleanupOnStart = value;
				await this.saveSettings();
			});
		});
		this.applySubToggleDisabledStyle(mcOnStart, !mcEnabled);

		// Subtoggle: Run At Midnight
		const mcAtMidnight = new Setting(containerEl)
			.setName("Run at midnight")
			.setDesc(
				"Schedules a daily cleanup at your local midnight while Obsidian remains open."
			);
		mcAtMidnight.addToggle((toggle) => {
			toggle.setValue(
				this.settings.enableMetadataCleanupAtMidnight ?? true
			);
			toggle.setDisabled(!mcEnabled);
			toggle.onChange(async (value) => {
				this.settings.enableMetadataCleanupAtMidnight = value;
				await this.saveSettings();
			});
		});
		this.applySubToggleDisabledStyle(mcAtMidnight, !mcEnabled);

		// Manual action button: Run on All Files in Vault
		new Setting(containerEl)
			.setName("Run on all files in vault")
			.setDesc(
				"Run metadata cleanup across every Markdown file in your vault now. This runs even if the automatic toggle above is disabled."
			)
			.addButton((btn) =>
				btn
					.setCta()
					.setButtonText("Run metadata cleanup")
					.onClick(async () => {
						try {
							// @ts-ignore
							this.app.workspace.trigger(
								"agile-metadata-cleanup-all"
							);
							new Notice(
								"Started metadata cleanup across vault…"
							);
						} catch {
							new Notice(
								"Could not start metadata cleanup. Please try again."
							);
						}
					})
			);
	}

	/**
	 * Adds or removes a CSS class that visually dims the toggle control area when disabled.
	 * Only affects the right-hand control column, not the name/description text.
	 */
	private applySubToggleDisabledStyle(setting: Setting, isDisabled: boolean) {
		const row = setting.settingEl;
		if (!row) return;
		if (isDisabled) {
			row.classList.add("agile-subtoggle-disabled");
			row.setAttribute("aria-disabled", "true");
		} else {
			row.classList.remove("agile-subtoggle-disabled");
			row.removeAttribute("aria-disabled");
		}
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

	/**
	 * Ensures any Agile settings-specific CSS is available.
	 * Styles are loaded via the plugin's styles.css, so this method is a no-op.
	 */
	private ensureAgileSettingsStyles(): void {
		// Intentionally left blank; CSS is provided by styles.css.
	}
}