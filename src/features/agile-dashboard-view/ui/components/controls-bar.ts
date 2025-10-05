import type { SettingsService } from "@settings";
import { buildGroupedMemberSelect } from "./member-select";

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
}

export interface ControlsBarRefs {
	root: HTMLElement;
	viewSelect: HTMLSelectElement;
	activeToggle: HTMLInputElement;
	activeToggleLabel: HTMLSpanElement;
	memberSelect: HTMLSelectElement;
	selectTeamsBtn: HTMLButtonElement;
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
	} = opts;

	const controlsContainer = container.createEl("div", {
		attr: {
			style: "display:flex; align-items:center; gap:8px; position:relative; flex-wrap:wrap;",
		},
	});

	const versionText = controlsContainer.createEl("p");
	const strongText = versionText.createEl("strong");
	strongText.textContent = `Agile Obsidian v${version}`;

	const viewSelect = controlsContainer.createEl("select");
	viewSelect.innerHTML = `
    <option value="projects">🚀 Projects</option>
    <option value="completed">✅ Completed</option>
  `;
	viewSelect.value = initialView;
	viewSelect.addEventListener("change", () => {
		onViewChange(
			(viewSelect.value as "projects" | "completed") ?? "projects"
		);
	});

	const memberSelect = buildGroupedMemberSelect(
		settingsService,
		initialAlias
	);
	memberSelect.addEventListener("change", () => {
		onMemberChange(memberSelect.value || null);
	});
	controlsContainer.appendChild(memberSelect);

	const selectTeamsBtn = controlsContainer.createEl("button", {
		text: "Select Teams",
	}) as HTMLButtonElement;
	selectTeamsBtn.addEventListener("click", (ev) => {
		ev.preventDefault();
		ev.stopPropagation();
		onSelectTeamsClick(selectTeamsBtn);
	});

	const statusToggleContainer = controlsContainer.createEl("span", {
		attr: { style: "display:inline-flex; align-items:center; gap:6px;" },
	});
	const activeToggleLabel = statusToggleContainer.createEl("span", {
		text: initialActiveOnly ? "Active" : "Inactive",
	});
	const activeToggle = statusToggleContainer.createEl("input", {
		type: "checkbox",
	}) as HTMLInputElement;
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

	return {
		root: controlsContainer,
		viewSelect,
		activeToggle,
		activeToggleLabel,
		memberSelect,
		selectTeamsBtn,
	};
}
