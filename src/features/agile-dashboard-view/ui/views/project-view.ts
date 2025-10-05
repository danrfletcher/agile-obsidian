import type { App } from "obsidian";
import type {
	TaskItem,
	TaskIndexService,
	TaskParams,
} from "@features/task-index";
import type { SettingsService } from "@settings";
import { processAndRenderObjectives } from "../components/objectives";
import { processAndRenderArtifacts } from "../components/artifacts";
import { processAndRenderInitiatives } from "../components/initiatives";
import { processAndRenderResponsibilities } from "../components/responsibilities";
import { processAndRenderPriorities } from "../components/priorities";
import { TeamSelection } from "../../domain/team-selection";

type RegisterDomEvent = (
	el: HTMLElement | Window | Document,
	type: string,
	handler: (evt: any) => void,
	options?: AddEventListenerOptions | boolean
) => void;

export interface ProjectViewOptions {
	app: App;
	container: HTMLElement;
	taskIndexService: TaskIndexService;
	settingsService: SettingsService;
	teamSelection: TeamSelection;
	statusActive: boolean;
	selectedAlias: string | null;
	registerDomEvent: RegisterDomEvent;
}

export async function renderProjectView(opts: ProjectViewOptions) {
	const {
		app,
		container,
		taskIndexService,
		settingsService,
		teamSelection,
		statusActive,
		selectedAlias,
		registerDomEvent,
	} = opts;

	if (
		!teamSelection.getImplicitAllSelected() &&
		teamSelection.getSelectedTeamSlugs().size === 0
	) {
		const msg = container.createEl("div", {
			attr: {
				style: "display:flex; align-items:center; justify-content:center; min-height: 240px; text-align:center; opacity:0.8;",
			},
		});
		msg.createEl("div", {
			text: "No organizations/teams selected. Select a team or organization to view the dashboard",
		});
		return;
	}

	let currentTasks: TaskItem[] = taskIndexService.getAllTasks();

	currentTasks = currentTasks.filter((t) =>
		teamSelection.isTaskAllowedByTeam(
			t as unknown as TaskItem,
			selectedAlias
		)
	);

	const taskMap = new Map<string, TaskItem>();
	const childrenMap = new Map<string, TaskItem[]>();
	currentTasks.forEach((t) => {
		if (t._uniqueId) {
			taskMap.set(t._uniqueId, t as unknown as TaskItem);
			childrenMap.set(t._uniqueId, []);
		}
	});
	currentTasks.forEach((t) => {
		const tt = t as unknown as TaskItem;
		if (tt._parentId && childrenMap.has(tt._parentId)) {
			childrenMap.get(tt._parentId)!.push(tt);
		}
	});

	const taskParams: TaskParams = {
		inProgress: true,
		completed: false,
		sleeping: false,
		cancelled: false,
	};
	const settings = settingsService.getRaw();

	if (settings.showObjectives) {
		processAndRenderObjectives(
			container,
			currentTasks as unknown as TaskItem[],
			statusActive,
			selectedAlias,
			app,
			taskMap,
			childrenMap,
			taskParams
		);
	}
	if (settings.showResponsibilities) {
		processAndRenderResponsibilities(
			container,
			currentTasks as unknown as TaskItem[],
			statusActive,
			selectedAlias,
			app,
			taskMap,
			childrenMap,
			taskParams
		);
	}
	processAndRenderArtifacts(
		container,
		currentTasks as unknown as TaskItem[],
		statusActive,
		selectedAlias,
		app,
		taskMap,
		childrenMap,
		taskParams,
		settings
	);
	if (settings.showInitiatives) {
		processAndRenderInitiatives(
			container,
			currentTasks as unknown as TaskItem[],
			statusActive,
			selectedAlias,
			app,
			taskMap,
			childrenMap,
			taskParams,
			registerDomEvent
		);
	}
	if (settings.showPriorities) {
		processAndRenderPriorities(
			container,
			currentTasks as unknown as TaskItem[],
			statusActive,
			selectedAlias,
			app,
			taskMap,
			childrenMap,
			taskParams
		);
	}
}
