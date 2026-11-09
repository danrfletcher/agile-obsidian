import type { Container } from "./container";
import { MarkdownView, Notice as ObsidianNotice } from "obsidian";
import { wireCanonicalFormatterForView } from "./wire/canonical-formatter";
import { createTemplatingWirer } from "./wire/templating";
import { normalizeTaskLine } from "@features/task-canonical-formatter";

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

	// 2) Vault-wide "Format All Files" wiring (triggered from Settings UI)
	plugin.registerEvent(
		// @ts-ignore - custom workspace events supported
		app.workspace.on("agile-canonical-format-all", () => {
			// Fire-and-forget async handler to satisfy no-misused-promises
			void (async () => {
				try {
					const mdFiles = app.vault.getMarkdownFiles();
					let changedFiles = 0;
					let changedLines = 0;

					for (const f of mdFiles) {
						const content = await app.vault.read(f);

						// Preserve EOL style and terminal newline
						const useCRLF = content.includes("\r\n");
						const eol = useCRLF ? "\r\n" : "\n";
						const hasTerminalEOL = content.endsWith(eol);

						const lines = content.split(/\r?\n/);
						let fileChanged = false;
						const out: string[] = new Array(lines.length) as string[];

						for (let i = 0; i < lines.length; i++) {
							const oldLine = lines[i] ?? "";
							const indentMatch = oldLine.match(/^\s*/);
							const indent = indentMatch ? indentMatch[0] : "";
							const sansIndent = oldLine.slice(indent.length);
							const normalizedSansIndent =
								normalizeTaskLine(sansIndent);
							const newLine = indent + normalizedSansIndent;
							out[i] = newLine;
							if (newLine !== oldLine) {
								fileChanged = true;
								changedLines++;
							}
						}

						if (fileChanged) {
							let next = out.join(eol);
							if (hasTerminalEOL && !next.endsWith(eol)) {
								next += eol;
							} else if (!hasTerminalEOL && next.endsWith(eol)) {
								next = next.slice(0, -eol.length);
							}
							await app.vault.modify(f, next);
							changedFiles++;
						}
					}

					new ObsidianNotice(
						`Canonical formatting complete: ${changedFiles} file(s), ${changedLines} line(s) updated.`
					);
				} catch (e) {
					new ObsidianNotice(
						`Canonical formatting failed: ${
							e instanceof Error ? e.message : String(e)
						}`
					);
				}
			})();
		})
	);

}
