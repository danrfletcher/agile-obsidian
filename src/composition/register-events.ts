import type { Container } from "./container";
import { MarkdownView, Notice as ObsidianNotice, App, Plugin } from "obsidian";
import type { OrgStructurePort } from "@features/org-structure";
import { wireTaskIndex } from "./wire/task-index";
import { wireCanonicalFormatterForView } from "./wire/canonical-formatter";
import { wireTemplatingForView } from "./wire/templating";
import { wireOrgStructure } from "./wire/org-structure";
import { wireTaskFlows } from "./wire/task-flows";
import { normalizeTaskLine } from "@features/task-canonical-formatter";

/**
 * Registers runtime event wiring and feature bootstrap.
 * This function is intentionally orchestration-only and delegates details to wire/* modules.
 */
export async function registerEvents(container: Container) {
	const { app, plugin } = container;

	// 1) TaskIndex wiring and ports
	const { taskIndexPorts } = await wireTaskIndex(container);

	// 2) Per-view wiring (templating + canonical formatting + assignment DOM handlers)
	let currentView: MarkdownView | null = null;
	let currentCanonicalDisposer: (() => void) | null = null;

	const unwireCurrentView = () => {
		if (currentCanonicalDisposer) {
			try {
				currentCanonicalDisposer();
			} catch { }
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
		wireTemplatingForView(app, currentView, plugin, taskIndexPorts);

		// Canonical formatter
		currentCanonicalDisposer = wireCanonicalFormatterForView(
			currentView,
			container
		);

		// Task assignment DOM handlers are wired by feature module internally if available (org-structure), via wireOrgStructure
		// to avoid duplication here.
	};

	// Initial wire and listeners to rewire on leaf/file changes
	wireForActiveView();

	plugin.registerEvent(
		app.workspace.on("active-leaf-change", (_leaf) => wireForActiveView())
	);
	plugin.registerEvent(
		app.workspace.on("file-open", (_file) => wireForActiveView())
	);

	// 3) Vault-wide "Format All Files" wiring (triggered from Settings UI)
	plugin.registerEvent(
		// @ts-ignore - custom workspace events supported
		app.workspace.on("agile-canonical-format-all", async () => {
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
					`Canonical formatting failed: ${e instanceof Error ? e.message : String(e)
					}`
				);
			}
		})
	);

	// 4) Org Structure wiring (debounced vault watchers + assignment commands + ports)
	const { orgStructurePort } = await wireOrgStructure(container);

	// 5) Task flows (cascades, status sequence, close manager, metadata cleanup)
	wireTaskFlows(container);

	// 6) When org-structure is present, wire task assignment DOM handlers for the active view
	//    via rewire (so it tracks view changes). The feature module owns its own cleanup.
	const wireAssignmentHandlersForActive = () => {
		const orgPorts = { orgStructure: orgStructurePort };
		const view = app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) return;
		try {
			const {
				wireTaskAssignmentDomHandlers,
			} = require("@features/task-assignment") as {
				wireTaskAssignmentDomHandlers: (
					app: App,
					view: MarkdownView,
					plugin: Plugin,
					orgPorts: { orgStructure: OrgStructurePort }
				) => void;
			};
			wireTaskAssignmentDomHandlers(app, view, plugin, orgPorts);
		} catch {
			// Feature may not expose dom wiring in this runtime, ignore.
		}
	};
	wireAssignmentHandlersForActive();
	plugin.registerEvent(
		app.workspace.on("active-leaf-change", (_leaf) =>
			wireAssignmentHandlersForActive()
		)
	);
	plugin.registerEvent(
		app.workspace.on("file-open", (_file) =>
			wireAssignmentHandlersForActive()
		)
	);
}
