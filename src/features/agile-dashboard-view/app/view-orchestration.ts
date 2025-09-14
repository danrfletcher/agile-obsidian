import type { Container } from "src/composition/container";
import {
	AgileDashboardView,
	VIEW_TYPE_AGILE_DASHBOARD,
} from "src/features/agile-dashboard-view/ui/views/agile-dashboard-view";
import { WorkspaceLeaf } from "obsidian";

/**
 * Register the Agile Dashboard view and associated commands.
 * Keeps registration self-contained so additional feature registrations
 * can be added the same way in the future.
 */
export async function registerAgileDashboardView(container: Container) {
	const { app, plugin } = container;

	plugin.registerView(
		VIEW_TYPE_AGILE_DASHBOARD,
		(leaf: WorkspaceLeaf) =>
			new AgileDashboardView(leaf, {
				taskIndex: container.taskIndexService, // wiring via ports
				settings: container.settingsService, // wiring via ports
			})
	);

	// Helper: open or reveal singleton dashboard leaf
	const openOrRevealDashboard = async () => {
		const existing = app.workspace.getLeavesOfType(
			VIEW_TYPE_AGILE_DASHBOARD
		);
		if (existing.length > 0) {
			// Reveal the first existing dashboard leaf
			app.workspace.revealLeaf(existing[0]);
			return;
		}
		// No existing leaf — create one
		const leaf = app.workspace.getLeaf(true); // create a new leaf only the first time
		await leaf.setViewState({ type: VIEW_TYPE_AGILE_DASHBOARD });
		app.workspace.revealLeaf(leaf);
	};

	// Ensure any open leaves are detached when the plugin unloads
	plugin.register(() => {
		app.workspace.detachLeavesOfType(VIEW_TYPE_AGILE_DASHBOARD);
	});

	// Prune duplicates if they somehow exist (keep the first one)
	const pruneDuplicateDashboardLeaves = () => {
		const leaves = app.workspace.getLeavesOfType(VIEW_TYPE_AGILE_DASHBOARD);
		if (leaves.length > 1) {
			// Keep the first, detach the rest
			for (let i = 1; i < leaves.length; i++) {
				try {
					leaves[i].detach();
				} catch (e) {
					console.warn(
						"Failed to detach duplicate Agile Dashboard leaf",
						e
					);
				}
			}
		}
	};

	// Also run pruning on layout changes as a safety net
	plugin.registerEvent(
		app.workspace.on("layout-change", () => {
			pruneDuplicateDashboardLeaves();
		})
	);

	// Register a simple command to open the dashboard (can be triggered by a status bar click)
	plugin.addCommand({
		id: "agile-open-dashboard",
		name: "Open Agile Dashboard",
		callback: async () => {
			await openOrRevealDashboard();
		},
	});

	// Add a ribbon icon (left sidebar) to open the dashboard
	try {
		const ribbonEl = plugin.addRibbonIcon(
			"list",
			"Open Agile Dashboard",
			async () => {
				await openOrRevealDashboard();
			}
		);
		// Ensure removal on unload
		plugin.register(() => ribbonEl.remove());
	} catch (e) {
		// Not all host environments expose addRibbonIcon; ignore if absent
		console.warn("Could not add ribbon icon for Agile Dashboard", e);
	}

	// Add a status bar item to open the dashboard
	try {
		const statusEl = plugin.addStatusBarItem();
		statusEl.classList.add("agile-dashboard-status");
		statusEl.setAttribute("title", "Open Agile Dashboard");
		statusEl.textContent = "⚡"; // Simple icon — replace with desired markup

		// Use registerDomEvent so it is cleaned up on unload
		plugin.registerDomEvent(statusEl, "click", async () => {
			await openOrRevealDashboard();
		});

		// Also ensure removal on unload
		plugin.register(() => statusEl.remove());
	} catch (e) {
		// addStatusBarItem may not be available in some host environments; ignore gracefully
		console.warn("Could not add status bar item for Agile Dashboard", e);
	}
}
