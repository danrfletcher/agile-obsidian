import type { Container } from "./container";
import { registerAgileDashboardView } from "src/features/agile-dashboard-view/app/view-orchestration";

export async function registerAllCommands(container: Container) {
	// Add future feature command registrars here.
	await registerAgileDashboardView(container);
}
