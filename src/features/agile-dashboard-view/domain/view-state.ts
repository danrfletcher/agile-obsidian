export type SelectedView = "projects" | "completed";

export interface DashboardState {
	selectedView: SelectedView;
	activeOnly: boolean;
	selectedAlias: string | null;
}
