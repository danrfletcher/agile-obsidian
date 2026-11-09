/**
 * Concrete Obsidian PluginSettingTab for Agile Templates settings.
 * Construct via app factory instead of instantiating directly in composition.
 * Side-effects: Manipulates DOM, triggers actions and persists settings.
 */
import { App, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import type { AgileObsidianSettings } from "@settings";

// Import the asset so the bundler emits a correct public URL.
import coffeeGifUrl from "../assets/coffee.gif";

export class AgileSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: Plugin,
		private settings: AgileObsidianSettings,
		private saveSettings: () => Promise<void>
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Ensure our settings-specific styles are present once.
		this.ensureAgileSettingsStyles();

		// Header row using a Setting heading with a coffee link on the right
		// The visible tab title is "Agile Templates" by product requirement, which the
		// lint rules below would otherwise reject (plugin name in heading, sentence case).
		// eslint-disable-next-line obsidianmd/settings-tab/no-problematic-settings-headings
		const headerSetting = new Setting(containerEl)
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setName("Agile Templates")
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

		// UX SHORTCUTS SECTION (foldable)
		const ux = this.createFoldableSection(
			containerEl,
			"UX shortcuts",
			"Turn ease-of-use features on or off.",
			this.settings.uiFoldUxShortcuts,
			async (folded) => {
				this.settings.uiFoldUxShortcuts = folded;
				await this.saveSettings();
			}
		);
		this.renderUxShortcutsSection(ux.contentEl);

		// AGILE TASK FORMATTING SECTION (foldable)
		const fmt = this.createFoldableSection(
			containerEl,
			"Agile task formatting",
			"Automatically keeps task lines clean and consistent. This section controls the canonical formatter and related task formatting actions.",
			this.settings.uiFoldAgileTaskFormatting,
			async (folded) => {
				this.settings.uiFoldAgileTaskFormatting = folded;
				await this.saveSettings();
			}
		);
		this.renderAgileTaskFormattingSection(fmt.contentEl);
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

		// Toggle: Default templates (the 44 built-ins)
		new Setting(containerEl)
			.setName("Default templates")
			.setDesc(
				"Turn the built-in template set on or off. When off, the built-in insert commands are removed and built-ins drop out of sequence menus and repeat. Chips already in your notes are never changed, and you can still remove them from the right-click menu."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.settings.enableDefaultTemplates)
					.onChange(async (value) => {
						this.settings.enableDefaultTemplates = value;
						// Persist; the save hook then updates the template registry live (no reload).
						await this.saveSettings();
					})
			);

		// Toggle: Double-Enter repeats template
		new Setting(containerEl)
			// eslint-disable-next-line obsidianmd/ui/sentence-case
			.setName("Double-Enter repeats template")
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
				"Reorder chips on task lines across every Markdown file in your vault. Counts the notes that would change and asks for confirmation first."
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
							// The handler dry-runs, asks "Reorder chips in N notes?" and
							// only then writes; any progress notice comes from it.
						} catch {
							new Notice(
								"Could not start formatting. Please try again."
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
