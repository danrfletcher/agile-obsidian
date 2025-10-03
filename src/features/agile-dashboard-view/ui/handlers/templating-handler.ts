/**
 * Dashboard-level click delegation for parameterized templates (non-assignment).
 * Opens schema/JSON modal to edit parameters, replaces the template wrapper in the source file,
 * triggers index refresh and dashboard re-render.
 *
 * Feature served: Fast, in-place editing of templated metadata rendered into the dashboard.
 */

import type { App, TFile } from "obsidian";
import { Notice } from "obsidian";
import {
	prefillTemplateParams,
	renderTemplateOnly,
	findTemplateById,
} from "@features/templating/app/templating-service";
import { showSchemaModal } from "@features/templating/ui/template-schema-modal";
import { showJsonModal } from "@features/templating/ui/template-json-modal";

type RegisterDomEvent = (
	el: HTMLElement | Window | Document,
	type: string,
	handler: (evt: any) => void,
	options?: AddEventListenerOptions | boolean
) => void;

export interface TemplatingHandlerOptions {
	app: App;
	viewContainer: HTMLElement; // the content area (this.containerEl.children[1])
	registerDomEvent: RegisterDomEvent; // ItemView.registerDomEvent binder for cleanup
	refreshForFile: (filePath?: string | null) => Promise<void>; // provided by view to suppress+refresh safely
}

export function attachDashboardTemplatingHandler(
	opts: TemplatingHandlerOptions
): void {
	const { app, viewContainer, registerDomEvent, refreshForFile } = opts;

	const onClick = async (evt: MouseEvent) => {
		try {
			const target = evt.target as HTMLElement | null;
			if (!target) return;

			const wrapper = target.closest(
				"span[data-template-wrapper][data-template-key]"
			) as HTMLElement | null;
			if (!wrapper) return;

			const templateKey = wrapper.getAttribute("data-template-key") || "";
			if (!templateKey) return;

			// Skip known hidden templates (e.g., members.assignee handled elsewhere)
			const def = findTemplateById(templateKey);
			if (!def || def.hiddenFromDynamicCommands) return;
			if (!def.hasParams) return;

			// Intercept click for parameterized template editing
			evt.preventDefault();
			evt.stopPropagation();
			// @ts-ignore
			evt.stopImmediatePropagation?.();

			// Map to task LI to get filePath and (optional) line hint
			const li = wrapper.closest(
				"li[data-file-path]"
			) as HTMLElement | null;
			const filePath = li?.getAttribute("data-file-path") || "";
			if (!filePath) return;

			const lineHintStr = li?.getAttribute("data-line") || "";
			const lineHint0 =
				lineHintStr && /^\d+$/.test(lineHintStr)
					? parseInt(lineHintStr, 10)
					: null;

			await handleTemplateEditOnDashboard(
				app,
				templateKey,
				wrapper,
				filePath,
				lineHint0,
				refreshForFile
			);
		} catch (err) {
			new Notice(
				`Template edit failed: ${String(
					(err as Error)?.message ?? err
				)}`
			);
		}
	};

	// Use capture to intercept clicks before default link behaviors
	registerDomEvent(viewContainer, "click", onClick, { capture: true });
}

async function handleTemplateEditOnDashboard(
	app: App,
	templateKey: string,
	wrapperEl: HTMLElement,
	filePath: string,
	lineHint0: number | null,
	refreshForFile: (filePath?: string | null) => Promise<void>
): Promise<void> {
	const def = findTemplateById(templateKey);
	if (!def?.hasParams) return;

	// Prefill strictly from [data-tpl-var] markers (or template parser override)
	const prefill =
		prefillTemplateParams(templateKey, wrapperEl) ??
		({} as Record<string, unknown>);

	// Show modal (schema or JSON)
	let params: Record<string, unknown> | undefined;
	if (def.paramsSchema && def.paramsSchema.fields?.length) {
		const schema = {
			...def.paramsSchema,
			fields: def.paramsSchema.fields.map((f: any) => ({
				...f,
				defaultValue:
					prefill[f.name] != null
						? String(prefill[f.name] ?? "")
						: f.defaultValue,
			})),
		};
		params = await showSchemaModal(app, templateKey, schema, true);
	} else {
		const jsonParams = JSON.stringify(prefill ?? {}, null, 2);
		params = (await showJsonModal(app, templateKey, jsonParams)) as
			| Record<string, unknown>
			| undefined;
	}
	if (!params) return; // cancelled

	// Render replacement HTML and preserve original instance id
	let newHtml = renderTemplateOnly(templateKey, params);
	const instanceId = wrapperEl.getAttribute("data-template-wrapper") || "";
	if (instanceId) {
		newHtml = newHtml.replace(
			/data-template-wrapper="[^"]*"/,
			`data-template-wrapper="${instanceId}"`
		);
	}

	// Optimistic UI update in dashboard (double-buffered approach)
	try {
		wrapperEl.outerHTML = newHtml;
	} catch {
		// ignore - if DOM replacement fails, we still proceed with disk update + refresh
	}

	// Prepare for optimistic refresh suppression (so our "modify" listener doesn't re-render twice)
	window.dispatchEvent(
		new CustomEvent("agile:prepare-optimistic-file-change", {
			detail: { filePath },
		})
	);

	// Update the source file in the vault
	const file = app.vault.getAbstractFileByPath(filePath) as TFile;
	if (!file) throw new Error(`File not found: ${filePath}`);
	const content = await app.vault.read(file);

	let updated: string | null = null;

	// 1) Replace by unique data-template-wrapper instance id
	if (instanceId) {
		const re = new RegExp(
			`<span\\b[^>]*\\bdata-template-wrapper\\s*=\\s*"` +
				escapeRegExp(instanceId) +
				`"[\\s\\S]*?>`,
			"i"
		);
		const m = re.exec(content);
		if (m && typeof m.index === "number") {
			const startIndex = m.index;
			const endIndex = findMatchingSpanEndIndexDeterministic(
				content,
				startIndex
			);
			if (endIndex !== -1) {
				updated =
					content.slice(0, startIndex) +
					newHtml +
					content.slice(endIndex);
			}
		}
	}

	// 2) Fallback: scan around lineHint0 for the first wrapper with matching data-template-key
	if (!updated && lineHint0 != null) {
		const lines = content.split(/\r?\n/);
		const idxs = [lineHint0, lineHint0 - 1, lineHint0 + 1].filter(
			(i) => i >= 0 && i < lines.length
		);
		for (const li of idxs) {
			const line = lines[li];
			const m = new RegExp(
				`<span\\b[^>]*\\bdata-template-key\\s*=\\s*"` +
					escapeRegExp(templateKey) +
					`"[\\s\\S]*?>`,
				"i"
			).exec(line);
			if (!m) continue;
			const openIdx = m.index;
			const absStart = offsetOfLineStart(lines, li) + openIdx;
			const absEnd = findMatchingSpanEndIndexDeterministic(
				content,
				absStart
			);
			if (absEnd !== -1) {
				updated =
					content.slice(0, absStart) +
					newHtml +
					content.slice(absEnd);
				break;
			}
		}
	}

	// 3) Final fallback: first wrapper with matching data-template-key anywhere in file
	if (!updated) {
		const reKey = new RegExp(
			`<span\\b[^>]*\\bdata-template-key\\s*=\\s*"` +
				escapeRegExp(templateKey) +
				`"[\\s\\S]*?>`,
			"i"
		);
		const m = reKey.exec(content);
		if (m && typeof m.index === "number") {
			const startIndex = m.index;
			const endIndex = findMatchingSpanEndIndexDeterministic(
				content,
				startIndex
			);
			if (endIndex !== -1) {
				updated =
					content.slice(0, startIndex) +
					newHtml +
					content.slice(endIndex);
			}
		}
	}

	if (!updated || updated === content) {
		throw new Error("Unable to update template wrapper in file");
	}

	await app.vault.modify(file, updated);

	// Index refresh + dashboard refresh (sync pass after optimistic)
	await refreshForFile(filePath);

	// Optional broadcast for other listeners
	window.dispatchEvent(
		new CustomEvent("agile:task-updated", { detail: { filePath } })
	);
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findMatchingSpanEndIndexDeterministic(
	s: string,
	startIdx: number
): number {
	const lower = s.toLowerCase();
	if (lower.slice(startIdx, startIdx + 5) !== "<span") {
		const firstOpen = lower.indexOf("<span", startIdx);
		if (firstOpen === -1) return -1;
		startIdx = firstOpen;
	}
	const firstGt = s.indexOf(">", startIdx);
	if (firstGt === -1) return -1;

	let depth = 1;
	let i = firstGt + 1;
	while (i < s.length) {
		const nextOpen = lower.indexOf("<span", i);
		const nextClose = lower.indexOf("</span>", i);
		if (nextClose === -1) return -1;

		if (nextOpen !== -1 && nextOpen < nextClose) {
			const gt = s.indexOf(">", nextOpen);
			if (gt === -1) return -1;
			depth += 1;
			i = gt + 1;
			continue;
		}
		depth -= 1;
		const closeEnd = nextClose + "</span>".length;
		if (depth === 0) return closeEnd;
		i = closeEnd;
	}
	return -1;
}

function offsetOfLineStart(lines: string[], lineNo: number): number {
	let off = 0;
	for (let i = 0; i < lineNo; i++) {
		off += lines[i].length + 1; // include newline
	}
	return off;
}
