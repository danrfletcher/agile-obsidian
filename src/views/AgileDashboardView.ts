import { ItemView, WorkspaceLeaf } from "obsidian";

export const VIEW_TYPE_AGILE_DASHBOARD = "agile-dashboard-view";

export class AgileDashboardView extends ItemView {
    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
    }

    getViewType() {
        return VIEW_TYPE_AGILE_DASHBOARD;
    }

    getDisplayText() {
        return "Agile Dashboard";
    }

    getIcon() {
        return "calendar-clock"; // Or any icon name from Obsidian's set
    }

    async onOpen() {
        const container = this.containerEl.children[1]; // The view's content area
        container.empty(); // Clear it to start blank
        container.createEl("h2", {
            text: "Agile Dashboard",
        }); // Temporary placeholder
        // Will add dashboard rendering here later
    }

    async onClose() {
        // Cleanup if needed (e.g., remove event listeners later)
    }
}
