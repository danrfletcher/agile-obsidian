/**
 * Presents identity selection UI within the settings panel.
 * Filters out aliases that represent external delegates, internal teams, or internal team members.
 * Side-effects: Manipulates DOM, calls saveSettings after selection.
 */
import type { AgileObsidianSettings } from "@settings";
import { Setting } from "obsidian";
import { getDisplayNameFromAlias } from "@shared/identity";

export class IdentityPresenter {
	constructor(
		private settings: AgileObsidianSettings,
		private saveSettings: () => Promise<void>
	) {}

	/**
	 * Renders the identity dropdown into the provided container.
	 * - Filters out "-ext", "-team", and "-int" aliases.
	 * - De-duplicates by alias and sorts by display name.
	 */
	mount(container: HTMLElement) {
		container.empty();
		const uniq = new Map<string, { alias: string; name: string }>();
		for (const t of this.settings.teams ?? []) {
			for (const m of t.members ?? []) {
				const alias = (m.alias ?? "").trim();
				if (!alias) continue;
				const lower = alias.toLowerCase();
				if (
					lower.endsWith("-ext") ||
					lower.endsWith("-team") ||
					lower.endsWith("-int")
				) {
					continue;
				}
				if (!uniq.has(alias)) {
					uniq.set(alias, {
						alias,
						name: getDisplayNameFromAlias(alias),
					});
				}
			}
		}
		if (uniq.size === 0) {
			const emptyEl = container.createEl("div");
			emptyEl.createEl("em", {
				text: "Cannot select identity: no team members detected yet.",
			});
			return;
		}
		const members = Array.from(uniq.values()).sort((a, b) =>
			a.name.localeCompare(b.name)
		);
		new Setting(container)
			.setName("Identity")
			.setDesc("Select your identity.")
			.addDropdown((dropdown) => {
				dropdown.addOption("", "(not set)");
				for (const m of members) {
					dropdown.addOption(m.alias, `${m.name} (${m.alias})`);
				}
				const current = this.settings.currentUserAlias ?? "";
				dropdown.setValue(uniq.has(current) ? current : "");
				dropdown.onChange(async (value) => {
					this.settings.currentUserAlias = value || null;
					await this.saveSettings();
				});
			});
	}
}