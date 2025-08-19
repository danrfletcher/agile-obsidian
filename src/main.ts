import {
	App,
	Editor,
	MarkdownView,
	Modal,
	Plugin,
	TFile,
	WorkspaceLeaf,
} from "obsidian";

import {
	AgileObsidianSettings,
	AgileSettingTab,
	DEFAULT_SETTINGS,
} from "./settings";
import {
	AgileDashboardView,
	VIEW_TYPE_AGILE_DASHBOARD,
} from "./views/AgileDashboardView";
import { TaskIndex } from "./index/TaskIndex";
import checkboxCss from "./styles/checkboxes.css";

export default class AgileObsidianPlugin extends Plugin {
	settings: AgileObsidianSettings;
	taskIndex: TaskIndex;
	private checkboxStyleEl?: HTMLStyleElement;

	private async injectCheckboxStyles(): Promise<void> {
		try {
			// Remove any existing style we added (hot reload safety)
			document
				.querySelectorAll(`style[data-agile-checkbox-styles="${this.manifest.id}"]`)
				.forEach((el) => el.parentElement?.removeChild(el));

			const styleEl = document.createElement("style");
			styleEl.setAttribute("data-agile-checkbox-styles", this.manifest.id);
			styleEl.textContent = checkboxCss;

			document.head.appendChild(styleEl);
			this.checkboxStyleEl = styleEl;
		} catch (e) {
			// no-op
		}
	}

	async onload() {
		// Load settings early (must come before adding the tab)
		await this.loadSettings();
		await this.injectCheckboxStyles();

		// Add the settings tab
		this.addSettingTab(new AgileSettingTab(this.app, this));

		this.taskIndex = TaskIndex.getInstance(this.app);
		await this.taskIndex.buildIndex();

		this.registerView(
			VIEW_TYPE_AGILE_DASHBOARD,
			(leaf) => new AgileDashboardView(leaf, this) // Updated: Pass 'this' (the plugin instance) for settings access
		);

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon(
			"logs", // Icon name (matches the view's icon)
			"Open Agile Obsidian Dashboard",
			() => {
				// Called when the user clicks the icon.
				this.activateView(); // Opens the blank dashboard leaf
			}
		);
		// Perform additional things with the ribbon (optional)
		ribbonIconEl.addClass("agile-dashboard-ribbon-class");

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText("Status Bar Text");

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: "open-sample-modal-simple",
			name: "Open sample modal (simple)",
			callback: () => {
				new SampleModal(this.app).open();
			},
		});
		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: "sample-editor-command",
			name: "Sample editor command",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				console.log(editor.getSelection());
				editor.replaceSelection("Sample Editor Command");
			},
		});
		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: "open-sample-modal-complex",
			name: "Open sample modal (complex)",
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						new SampleModal(this.app).open();
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			},
		});

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, "click", (evt: MouseEvent) => {
			console.log("click", evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(
			window.setInterval(() => console.log("setInterval"), 5 * 60 * 1000)
		);

		this.registerEvent(
			this.app.vault.on("modify", async (file) => {
				if (file instanceof TFile && file.extension === "md") {
					await this.taskIndex.updateFile(file);
				}
			})
		);

		this.registerEvent(
			this.app.vault.on("create", async (file) => {
				if (file instanceof TFile && file.extension === "md") {
					await this.taskIndex.updateFile(file);
				}
			})
		);

		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (file instanceof TFile && file.extension === "md") {
					this.taskIndex.removeFile(file.path);
				}
			})
		);

		this.registerEvent(
			this.app.vault.on("rename", async (file, oldPath) => {
				if (file instanceof TFile && file.extension === "md") {
					this.taskIndex.removeFile(oldPath);
					await this.taskIndex.updateFile(file);
				}
			})
		);
	}

	onunload() {
		if (this.checkboxStyleEl && this.checkboxStyleEl.parentNode) {
			this.checkboxStyleEl.parentNode.removeChild(this.checkboxStyleEl);
			this.checkboxStyleEl = undefined;
		}
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// @ts-ignore - Suppress type error for custom event (Obsidian typings don't support arbitrary events)
		this.app.workspace.trigger("agile-settings-changed");
	}

	async activateView() {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_AGILE_DASHBOARD);

		if (leaves.length > 0) {
			// If already open, reveal and activate the existing one (wherever it is)
			leaf = leaves[0];
			workspace.revealLeaf(leaf);
			workspace.setActiveLeaf(leaf); // Ensure it's focused
		} else {
			// Create a new leaf in the main central area (as a tab)
			leaf = workspace.getLeaf(true);
			await leaf.setViewState({
				type: VIEW_TYPE_AGILE_DASHBOARD,
				active: true,
			});
			workspace.revealLeaf(leaf);
		}
	}
}

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.setText("Woah!");
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
