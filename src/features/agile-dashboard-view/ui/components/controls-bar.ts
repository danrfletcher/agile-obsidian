import type { SettingsService } from "@settings";
import {
	buildGroupedMemberSelect,
	refreshGroupedMemberSelect,
} from "./member-select";

export interface ControlsBarOptions {
	container: HTMLElement;
	version: string;
	settingsService: SettingsService;
	initialView: "projects" | "completed";
	initialActiveOnly: boolean;
	initialAlias: string | null;
	onViewChange: (v: "projects" | "completed") => void;
	onActiveToggleChange: (active: boolean) => void;
	onMemberChange: (alias: string | null) => void;
	onSelectTeamsClick: (anchor: HTMLElement) => void;
	/** New: trigger a full task-index rebuild */
	onRebuildIndexClick: () => void | Promise<void>;

	/** New: provide current team selection state so we can filter the member dropdown */
	getSelectedTeamSlugs: () => Set<string>;
	getImplicitAllSelected: () => boolean;
}

export interface ControlsBarRefs {
	root: HTMLElement;
	viewSelect: HTMLSelectElement;
	activeToggle: HTMLInputElement;
	activeToggleLabel: HTMLSpanElement;
	memberSelect: HTMLSelectElement;
	selectTeamsBtn: HTMLButtonElement;
	rebuildBtn: HTMLButtonElement;

	/** New: repopulate the member dropdown based on current team selection; returns applied alias */
	refreshMemberSelect: (preferredAlias?: string | null) => string | null;
}

export function renderControlsBar(opts: ControlsBarOptions): ControlsBarRefs {
	const {
		container,
		version,
		settingsService,
		initialView,
		initialActiveOnly,
		initialAlias,
		onViewChange,
		onActiveToggleChange,
		onMemberChange,
		onSelectTeamsClick,
		onRebuildIndexClick,
		getSelectedTeamSlugs,
		getImplicitAllSelected,
	} = opts;

	const controlsContainer = container.createEl("div", {
		attr: {
			style: "display:flex; align-items:center; gap:8px; position:relative; flex-wrap:wrap;",
		},
	});

	// Version
	const versionText = controlsContainer.createEl("p");
	const strongText = versionText.createEl("strong");
	strongText.textContent = `Agile Obsidian v${version}`;

	// Rebuild index icon button (moved here: right after version text)
	const rebuildBtn = controlsContainer.createEl("button", {
		text: "↻",
	});
	rebuildBtn.title = "Rebuild task index";
	rebuildBtn.setAttribute("aria-label", "Rebuild task index");
	rebuildBtn.addEventListener("click", (ev) => {
		ev.preventDefault();
		ev.stopPropagation();
		void onRebuildIndexClick();
	});

	// View selector comes after the rebuild button
	const viewSelect = controlsContainer.createEl("select");
	viewSelect.createEl("option", {
		value: "projects",
		// eslint-disable-next-line obsidianmd/ui/sentence-case
		text: "🚀 Projects",
	});
	viewSelect.createEl("option", {
		value: "completed",
		// eslint-disable-next-line obsidianmd/ui/sentence-case
		text: "✅ Completed",
	});
	viewSelect.value = initialView;
	viewSelect.addEventListener("change", () => {
		onViewChange(
			(viewSelect.value as "projects" | "completed") ?? "projects"
		);
	});

	// Member selector (now filtered by currently selected teams)
	const memberSelect = buildGroupedMemberSelect(
		settingsService,
		initialAlias,
		{
			selectedTeamSlugs: getSelectedTeamSlugs(),
			implicitAllSelected: getImplicitAllSelected(),
		}
	);
	memberSelect.addEventListener("change", () => {
		onMemberChange(memberSelect.value || null);
	});
	controlsContainer.appendChild(memberSelect);

	// Team selection button
	const selectTeamsBtn = controlsContainer.createEl("button", {
		text: "Select teams",
	});
	selectTeamsBtn.addEventListener("click", (ev) => {
		ev.preventDefault();
		ev.stopPropagation();
		onSelectTeamsClick(selectTeamsBtn);
	});

	// Active/Inactive toggle
	const statusToggleContainer = controlsContainer.createEl("span", {
		attr: { style: "display:inline-flex; align-items:center; gap:6px;" },
	});
	const activeToggleLabel = statusToggleContainer.createEl("span", {
		text: initialActiveOnly ? "Active" : "Inactive",
	});
	const activeToggle: HTMLInputElement = statusToggleContainer.createEl(
		"input",
		{ type: "checkbox" }
	);
	activeToggle.checked = initialActiveOnly;
	statusToggleContainer.style.display =
		initialView === "projects" ? "inline-flex" : "none";

	activeToggle.addEventListener("change", () => {
		activeToggleLabel.textContent = activeToggle.checked
			? "Active"
			: "Inactive";
		onActiveToggleChange(activeToggle.checked);
	});

	viewSelect.addEventListener("change", () => {
		statusToggleContainer.style.display =
			viewSelect.value === "projects" ? "inline-flex" : "none";
	});

	// Provide a way to refresh the member select when teams change
	const refreshMemberSelect = (
		preferredAlias?: string | null
	): string | null => {
		const applied = refreshGroupedMemberSelect(
			memberSelect,
			settingsService,
			preferredAlias ?? memberSelect.value ?? null,
			{
				selectedTeamSlugs: getSelectedTeamSlugs(),
				implicitAllSelected: getImplicitAllSelected(),
			}
		);
		return applied;
	};

	return {
		root: controlsContainer,
		viewSelect,
		activeToggle,
		activeToggleLabel,
		memberSelect,
		selectTeamsBtn,
		rebuildBtn,
		refreshMemberSelect,
	};
}