/**
 * Templating Sequencer - Application Service
 *
 * Responsibilities:
 * - Build & index available sequences.
 * - Given a clicked wrapper (templateKey + element), compute the forward/back options.
 * - Execute a move: read current params, map to target params, prompt for Additional Properties,
 *   render, and overwrite current wrapper (either in the current view or directly in the file).
 *
 * This file is framework-aware (uses Obsidian app + existing templating-params-editor modals).
 */

import { TFile, type App, type MarkdownView } from "obsidian";
import type { Sequence, SequenceIndex } from "../domain/types";
import { presetSequences } from "../domain/preset-sequences";

// Import templating engine ports
import {
	prefillTemplateParams,
	renderTemplateOnly,
	replaceTemplateWrapperOnCurrentLine,
	findTemplateById,
} from "@features/templating-engine/app/templating-service";
import { showSchemaModal } from "@features/templating-params-editor";

/**
 * Build an index for fast runtime lookups.
 */
export function buildSequenceIndex(sequences: Sequence[]): SequenceIndex {
	const byStart = new Map<string, Sequence[]>();
	const reversibleByTarget = new Map<string, Sequence[]>();

	for (const s of sequences) {
		const list = byStart.get(s.startTemplate) ?? [];
		list.push(s);
		byStart.set(s.startTemplate, list);

		if (s.direction === "both") {
			const back = reversibleByTarget.get(s.targetTemplate) ?? [];
			back.push(s);
			reversibleByTarget.set(s.targetTemplate, back);
		}
	}

	return { byStart, reversibleByTarget };
}

export const sequenceIndex = buildSequenceIndex(presetSequences);

/**
 * Read "current" params off the wrapper using the templating-engine's explicit markers.
 * Returns a plain object of string values.
 */
export function getCurrentParamsFromWrapper(
	wrapperEl: HTMLElement
): Record<string, unknown> {
	try {
		return (
			prefillTemplateParams(
				wrapperEl.getAttribute("data-template-key") || "",
				wrapperEl
			) ?? {}
		);
	} catch {
		return {};
	}
}

/**
 * Produce a filtered schema that contains only fields missing on "candidate" params,
 * to be used by the "Additional Properties" modal.
 * 
 * Change: Only prompt for fields that are explicitly required.
 * Optional fields are ignored even if they are missing; they will simply be left off.
 */
function makeMissingOnlySchema(
	fullSchema: any | undefined,
	candidate: Record<string, unknown>
): any | undefined {
	if (
		!fullSchema ||
		!Array.isArray(fullSchema.fields) ||
		fullSchema.fields.length === 0
	) {
		return undefined;
	}

	const missingFields = fullSchema.fields.filter((f: any) => {
		const required = !!f?.required;
		if (!required) return false; // do not prompt for optional fields

		const name = String(f?.name ?? "").trim();
		if (!name) return false;

		const v = candidate[name];
		const str = v == null ? "" : String(v).trim();
		return str.length === 0; // missing or empty -> needs collection (only for required)
	});

	if (missingFields.length === 0) return undefined;

	return {
		...fullSchema,
		title: "Additional Properties",
		fields: missingFields.map((f: any) => ({ ...f })),
		titles: undefined,
	};
}

/**
 * Helpers: automatic param mapping layer
 * - We only prefill keys present on the destination template schema (drop extras).
 * - We only prefill when a source value is non-empty after trimming (empty values remain "missing" to trigger the modal).
 * - Sequence callback overrides (variableMapOverrides) win over these defaults (so users can transform or replace).
 */
function getSchemaFieldNames(def: any | undefined): string[] {
	if (!def?.paramsSchema?.fields || !Array.isArray(def.paramsSchema.fields))
		return [];
	return def.paramsSchema.fields
		.map((f: any) => String(f?.name ?? "").trim())
		.filter((n: string) => n.length > 0);
}

function normalizeString(v: unknown): string {
	return v == null ? "" : String(v).trim();
}

function computeAutoMappedParams(
	source: Record<string, unknown>,
	destTemplateDef: any | undefined
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	const destKeys = getSchemaFieldNames(destTemplateDef);
	if (destKeys.length === 0) return out;

	for (const key of destKeys) {
		const val = normalizeString(source[key]);
		if (val.length > 0) {
			out[key] = val;
		}
	}
	return out;
}

/**
 * Execute a sequence move (forward/backward) using the active MarkdownView.
 * - Reads current params from wrapper
 * - Applies automatic pass-through for shared variable names (drop extras)
 * - Applies user-provided variableMapOverrides on top (if present)
 * - Prompts for missing fields via "Additional Properties"
 * - Renders target HTML and overwrites the clicked wrapper (preserving instance id via the editor API)
 */
export async function executeSequenceMove(args: {
	app: App;
	view: MarkdownView;
	wrapperEl: HTMLElement;
	currentTemplateKey: string;
	currentInstanceId?: string | null;
	sequence: Sequence<any, any>;
	direction: "forward" | "backward";
}): Promise<void> {
	const {
		app,
		view,
		wrapperEl,
		currentTemplateKey,
		currentInstanceId,
		sequence,
		direction,
	} = args;

	const editor: any = (view as any).editor;

	// Current params from the clicked wrapper instance
	const currentParams = getCurrentParamsFromWrapper(wrapperEl);

	const startTemplate =
		direction === "forward"
			? sequence.startTemplate
			: sequence.targetTemplate; // clicked template on backward
	const targetTemplate =
		direction === "forward"
			? sequence.targetTemplate
			: sequence.startTemplate;

	// Ensure the clicked template matches the expected "start" for this move
	// Note: startTemplate is always the clicked template (forward: sequence.startTemplate; backward: sequence.targetTemplate)
	if (currentTemplateKey !== startTemplate) return;

	// Resolve target template definition
	const targetDef = findTemplateById(targetTemplate) as
		| {
				id: string;
				hasParams?: boolean;
				paramsSchema?: any;
				label?: string;
		  }
		| undefined;
	if (!targetDef)
		throw new Error(`Unknown target template: ${targetTemplate}`);

	// 1) Automatic pass-through for shared names (drop extras)
	const autoDefaults = computeAutoMappedParams(currentParams, targetDef);

	// 2) Sequence callback overrides (user-defined mapping wins over defaults)
	let callbackParams: Record<string, unknown> = {};
	const overrides = sequence.variableMapOverrides;
	if (direction === "forward") {
		const res = await overrides?.forward?.({
			start: currentParams,
		});
		callbackParams = (res ?? {}) as Record<string, unknown>;
	} else {
		const res = await overrides?.backward?.({ target: currentParams });
		callbackParams = (res ?? {}) as Record<string, unknown>;
	}

	// Compose: defaults first, then user callback overrides
	let baseParams: Record<string, unknown> = {
		...autoDefaults,
		...callbackParams,
	};

	// 3) Collect any missing fields via filtered schema (automatic prompting)
	let finalParams = { ...(baseParams ?? {}) };
	if (
		targetDef.paramsSchema &&
		Array.isArray(targetDef.paramsSchema.fields)
	) {
		const missingSchema = makeMissingOnlySchema(
			targetDef.paramsSchema,
			finalParams
		);
		if (missingSchema && missingSchema.fields.length > 0) {
			const collected = await showSchemaModal(
				app,
				targetTemplate,
				{
					...missingSchema,
					fields: missingSchema.fields.map((f: any) => ({
						...f,
						defaultValue:
							finalParams[f.name] != null
								? String(finalParams[f.name])
								: f.defaultValue,
					})),
				},
				false
			);
			if (collected) finalParams = { ...finalParams, ...collected };
		}
	}

	// 4) Render only the inner content (wrapper is unchanged)
	const newInnerHtml = renderTemplateOnly(targetTemplate, finalParams);

	// 5) Replace the wrapper inner HTML in the current line via templating-engine helper
	await replaceTemplateWrapperOnCurrentLine(
		app as any,
		view as any,
		editor as any,
		currentTemplateKey,
		newInnerHtml,
		currentInstanceId || undefined
	);
}

/**
 * Utility: escape a string for use in RegExp
 */
function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace a wrapper's inner HTML in the specified file, targeting a specific line when possible.
 * Strategy:
 * - Prefer the hinted line (data-line) and replace the first span containing the "data-template-wrapper=<id>"
 *   (if instanceId is provided) or "data-template-key=<key>" (fallback).
 * - Replace ONLY the inner HTML of the matching wrapper, leaving the wrapper tag/attributes intact.
 * - Keep EOL style intact.
 */
async function replaceWrapperInnerHtmlOnFileLine(params: {
	app: App;
	filePath: string;
	line0?: number | null;
	instanceId?: string | null;
	templateKey: string;
	newInnerHtml: string;
}): Promise<void> {
	const { app, filePath, line0, instanceId, templateKey, newInnerHtml } =
		params;

	const af = app.vault.getAbstractFileByPath(filePath);
	if (!(af instanceof TFile)) throw new Error(`File not found: ${filePath}`);

	const content = await app.vault.read(af);
	const useCRLF = content.includes("\r\n");
	const eol = useCRLF ? "\r\n" : "\n";
	const lines = content.split(/\r?\n/);

	const tryReplaceInLine = (
		line: string
	): { changed: boolean; out: string } => {
		const idStr =
			instanceId && instanceId.trim()
				? `data-template-wrapper="${escapeRegExp(instanceId.trim())}"`
				: null;
		const keyStr = `data-template-key="${escapeRegExp(templateKey)}"`;

		const idPos = idStr ? line.search(new RegExp(idStr)) : -1;
		const keyPos = line.search(new RegExp(keyStr));

		// If both id and key exist, prefer id. If no id, fall back to key.
		let anchorPos = idPos >= 0 ? idPos : keyPos;
		if (anchorPos < 0) return { changed: false, out: line };

		// Find the opening <span ...> that contains our anchor
		let openStart = line.lastIndexOf("<span", anchorPos);
		if (openStart < 0) return { changed: false, out: line };
		const openEnd = line.indexOf(">", anchorPos);
		if (openEnd < 0) return { changed: false, out: line };

		// Sanity check: ensure this opening tag indeed has the template key
		const openTag = line.slice(openStart, openEnd + 1);
		if (!new RegExp(keyStr, "i").test(openTag)) {
			// Anchor might be stale; bail out to avoid corrupting unrelated spans
			return { changed: false, out: line };
		}

		// Find the closing </span> that matches this opening tag.
		// Heuristic (single-line assumption): find the next </span>.
		// In typical template wrappers, content remains on the same line.
		const closeStart = line.indexOf("</span>", openEnd + 1);
		if (closeStart < 0) return { changed: false, out: line };

		const before = line.slice(0, openEnd + 1);
		const after = line.slice(closeStart);
		const out = `${before}${newInnerHtml}${after}`;
		return { changed: true, out };
	};

	let changed = false;

	const tryWindowReplace = (idx: number) => {
		if (idx < 0 || idx >= lines.length) return false;
		const res = tryReplaceInLine(lines[idx] ?? "");
		if (res.changed) {
			lines[idx] = res.out;
			return true;
		}
		return false;
	};

	// 1) Targeted line
	if (typeof line0 === "number" && line0 >= 0 && line0 < lines.length) {
		if (tryWindowReplace(line0)) changed = true;
		else if (tryWindowReplace(line0 - 1)) changed = true;
		else if (tryWindowReplace(line0 + 1)) changed = true;
	}

	// 2) Global scan fallback
	if (!changed) {
		for (let i = 0; i < lines.length; i++) {
			if (tryWindowReplace(i)) {
				changed = true;
				break;
			}
		}
	}

	if (!changed) {
		throw new Error(
			"Unable to locate template wrapper in file for replacement."
		);
	}

	const next = lines.join(eol);
	if (next !== content) {
		await app.vault.modify(af, next);
	}
}

/**
 * Execute a sequence move (forward/backward) directly on a file.
 * Supports custom views where we click on a rendered wrapper and need to overwrite the source note
 * without requiring an active editor view.
 *
 * Automatic mapping rules are the same as the editor path.
 */
export async function executeSequenceMoveOnFile(args: {
	app: App;
	filePath: string;
	line0?: number | null;
	wrapperEl: HTMLElement;
	currentTemplateKey: string;
	currentInstanceId?: string | null;
	sequence: Sequence<any, any>;
	direction: "forward" | "backward";
}): Promise<void> {
	const {
		app,
		filePath,
		line0,
		wrapperEl,
		currentTemplateKey,
		currentInstanceId,
		sequence,
		direction,
	} = args;

	// 1) Current params from the rendered wrapper
	const currentParams = getCurrentParamsFromWrapper(wrapperEl);

	// 2) Resolve start/target and template def
	const startTemplate =
		direction === "forward"
			? sequence.startTemplate
			: sequence.targetTemplate; // clicked template on backward
	const targetTemplate =
		direction === "forward"
			? sequence.targetTemplate
			: sequence.startTemplate;

	// Ensure the clicked template matches the expected "start" for this move
	if (currentTemplateKey !== startTemplate) return;

	const targetDef = findTemplateById(targetTemplate) as
		| {
				id: string;
				hasParams?: boolean;
				paramsSchema?: any;
		  }
		| undefined;
	if (!targetDef)
		throw new Error(`Unknown target template: ${targetTemplate}`);

	// 3) Automatic pass-through for shared names (drop extras)
	const autoDefaults = computeAutoMappedParams(currentParams, targetDef);

	// 4) Sequence callback overrides (user-defined mapping wins over defaults)
	let callbackParams: Record<string, unknown> = {};
	const overrides = sequence.variableMapOverrides;
	if (direction === "forward") {
		const res = await overrides?.forward?.({
			start: currentParams,
		});
		callbackParams = (res ?? {}) as Record<string, unknown>;
	} else {
		const res = await overrides?.backward?.({ target: currentParams });
		callbackParams = (res ?? {}) as Record<string, unknown>;
	}

	let baseParams: Record<string, unknown> = {
		...autoDefaults,
		...callbackParams,
	};

	// 5) Collect missing fields (Additional Properties)
	let finalParams = { ...(baseParams ?? {}) };
	if (
		targetDef.paramsSchema &&
		Array.isArray(targetDef.paramsSchema.fields)
	) {
		const missingSchema = makeMissingOnlySchema(
			targetDef.paramsSchema,
			finalParams
		);
		if (missingSchema && missingSchema.fields.length > 0) {
			const collected = await showSchemaModal(
				app,
				targetTemplate,
				{
					...missingSchema,
					fields: missingSchema.fields.map((f: any) => ({
						...f,
						defaultValue:
							finalParams[f.name] != null
								? String(finalParams[f.name])
								: f.defaultValue,
					})),
				},
				false
			);
			if (collected) finalParams = { ...finalParams, ...collected };
		}
	}

	// 6) Render inner HTML only
	const newInnerHtml = renderTemplateOnly(targetTemplate, finalParams);

	// 7) Replace in file (targeting wrapper on the hinted line; falling back to scan)
	await replaceWrapperInnerHtmlOnFileLine({
		app,
		filePath,
		line0: typeof line0 === "number" ? line0 : null,
		instanceId: currentInstanceId ?? null,
		templateKey: currentTemplateKey,
		newInnerHtml,
	});
}

/**
 * Compute menu options (forward/backward) for a clicked template wrapper.
 */
export function computeAvailableMoves(
	templateKey: string,
	currentParams: Record<string, unknown>
): {
	forward: Array<Sequence<any, any>>;
	backward: Array<Sequence<any, any>>; // reversible items where clicked is the target
} {
	const forward = sequenceIndex.byStart.get(templateKey) ?? [];
	const backward = sequenceIndex.reversibleByTarget.get(templateKey) ?? [];

	// Optional isAvailable filtering
	const fwd = forward.filter(
		(s) =>
			!s.isAvailable ||
			s.isAvailable({
				startTemplate: s.startTemplate,
				targetTemplate: s.targetTemplate,
				currentParams,
				direction: "forward",
			})
	);
	const back = backward.filter(
		(s) =>
			!s.isAvailable ||
			s.isAvailable({
				startTemplate: s.startTemplate,
				targetTemplate: s.targetTemplate,
				currentParams,
				direction: "backward",
			})
	);

	return { forward: fwd, backward: back };
}
