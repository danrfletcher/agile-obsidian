import type { Container } from "./container";
import { MarkdownView, Notice as ObsidianNotice } from "obsidian";
import type { TFile } from "obsidian";
import { wireCanonicalFormatterForView } from "./wire/canonical-formatter";
import { createTemplatingWirer } from "./wire/templating";
import { createVaultReorderRunner } from "@features/task-canonical-formatter";
import { confirmDialog } from "./ui/confirm-modal";

/**
 * Registers runtime event wiring and feature bootstrap.
 * This function is intentionally orchestration-only and delegates details to wire/* modules.
 */
export async function registerEvents(container: Container) {
	const { app, plugin } = container;

	// 1) Per-view wiring (templating + canonical formatting)
	const wireTemplatingForView = createTemplatingWirer(app, plugin);
	let currentView: MarkdownView | null = null;
	let currentCanonicalDisposer: (() => void) | null = null;

	const unwireCurrentView = () => {
		if (currentCanonicalDisposer) {
			try {
				currentCanonicalDisposer();
			} catch {
				// Ignore errors during dispose to avoid breaking re-wiring.
			}
			currentCanonicalDisposer = null;
		}
		currentView = null;
	};

	const wireForActiveView = () => {
		const active = app.workspace.getActiveViewOfType(MarkdownView) ?? null;
		if (currentView === active) return;
		if (currentView) unwireCurrentView();
		currentView = active;
		if (!currentView) return;

		// Templating DOM handlers + UX shortcuts
		wireTemplatingForView(currentView);

		// Canonical formatter
		currentCanonicalDisposer = wireCanonicalFormatterForView(
			currentView,
			container
		);
	};

	// Tear down the per-view canonical formatter listeners when the plugin unloads.
	// (Templating DOM listeners are registered via plugin.registerDomEvent and are
	// removed by Obsidian on unload.)
	plugin.register(() => unwireCurrentView());

	// Initial wire and listeners to rewire on leaf/file changes
	wireForActiveView();

	plugin.registerEvent(
		app.workspace.on("active-leaf-change", (_leaf) => wireForActiveView())
	);
	plugin.registerEvent(
		app.workspace.on("file-open", (_file) => wireForActiveView())
	);

	// 2) Vault-wide "Format All Files" wiring (triggered from Settings UI).
	// Dry-runs first, asks "Reorder chips in N notes?", and only then rewrites the N
	// notes that would change. Reads files only when the button is pressed.
	const runVaultReorder = createVaultReorderRunner<TFile>({
		listFiles: () => app.vault.getMarkdownFiles(),
		pathOf: (f) => f.path,
		read: (f) => app.vault.read(f),
		process: async (f, fn) => {
			await app.vault.process(f, fn);
		},
		confirm: (n) =>
			confirmDialog(app, {
				title: `Reorder chips in ${n} ${n === 1 ? "note" : "notes"}?`,
				message:
					"Only the order of chips on task lines changes. Nothing is removed.",
				confirmText: "Reorder",
			}),
		notify: (message) => {
			new ObsidianNotice(message);
		},
		yieldToUi: () => new Promise<void>((r) => setTimeout(r, 0)),
	});

	plugin.registerEvent(
		// @ts-ignore - custom workspace events supported
		app.workspace.on("agile-canonical-format-all", () => {
			// Fire-and-forget async handler to satisfy no-misused-promises
			void runVaultReorder().catch((e) => {
				new ObsidianNotice(
					`Canonical formatting failed: ${
						e instanceof Error ? e.message : String(e)
					}`
				);
			});
		})
	);
}
