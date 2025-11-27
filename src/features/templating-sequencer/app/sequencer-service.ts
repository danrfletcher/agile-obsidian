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

// Infer the schema type used by the params editor to avoid hard-coding it here.
type ModalSchema = Parameters<typeof showSchemaModal>[2];

// Start from whatever field type the modal schema uses, but ensure we always
// have optional `name` and `required` available in this file.
type ModalSchemaField =
	ModalSchema extends { fields: Array<infer F> }
		? F & {
				name?: string;
				required?: boolean;
		  }
		: {
				name?: string;
				required?: boolean;
		  };

type ModalSchemaWithFields = Omit<ModalSchema, "fields" | "title" | "titles"> & {
	fields: ModalSchemaField[];
} & Pick<ModalSchema, "title" | "titles">;

// Minimal view of a template definition that this module cares about.
interface TemplateWithSchema {
	id: string;
	label?: string;
	hasParams?: boolean;
	paramsSchema?: ModalSchema;
}

// Minimal editor type inferred from the templating engine helper
type MinimalEditorForReplace = Parameters<
	typeof replaceTemplateWrapperOnCurrentLine
>[2];

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

// Safely coerce known primitive values to strings for UI/schema usage.
// Avoids accidentally stringifying objects as "[object Object]".
function toSafeString(value: unknown): string | undefined {
	if (value == null) {
		return undefined;
	}

	if (typeof value === "string") {
		return value;
	}

	if (
		typeof value === "number" ||
		typeof value === "boolean" ||
		typeof value === "bigint"
	) {
		return String(value);
	}

	// For objects/functions/symbols we don't attempt coercion here.
	return undefined;
}

// Determine whether a required field value should be treated as "missing".
function isMissingRequiredParamValue(value: unknown): boolean {
	const str = toSafeString(value);
	if (str == null) {
		return true;
	}
	return str.trim().length === 0;
}

/**
 * Narrow to fields that actually carry a `defaultValue` property.
 *
 * Using `in` avoids `no-unsafe-return`, and requiring `defaultValue`
 * in the narrowed type sidesteps `no-redundant-type-constituents`.
 */
function hasDefaultValue(
	field: ModalSchemaField
): field is ModalSchemaField & { defaultValue: unknown } {
	return typeof field === "object" && field !== null && "defaultValue" in field;
}

/**
 * Produce a filtered schema that contains only fields missing on "candidate" params,
 * to be used by the "Additional Properties" modal.
 *
 * Change: Only prompt for fields that are explicitly required.
 * Optional fields are ignored even if they are missing; they will simply be left off.
 */
function makeMissingOnlySchema(
	fullSchema: ModalSchema | undefined,
	candidate: Record<string, unknown>
): ModalSchemaWithFields | undefined {
	if (!fullSchema) {
		return undefined;
	}

	const schema = fullSchema as ModalSchemaWithFields;
	const { fields } = schema;

	if (!Array.isArray(fields) || fields.length === 0) {
		return undefined;
	}

	const missingFields = fields.filter((f) => {
		const required = Boolean(f.required);
		if (!required) return false; // do not prompt for optional fields

		const name = String(f.name ?? "").trim();
		if (!name) return false;

		const value = candidate[name];
		return isMissingRequiredParamValue(value);
	});

	if (missingFields.length === 0) return undefined;

	return {
		...schema,
		title: "Additional Properties",
		fields: missingFields.map((f) => ({ ...f })),
		titles: undefined,
	};
}

/**
 * Helpers: automatic param mapping layer
 * - We only prefill keys present on the destination template schema (drop extras).
 * - We only prefill when a source value is non-empty after trimming (empty values remain "missing" to trigger the modal).
 * - Sequence callback overrides (variableMapOverrides) win over these defaults (so users can transform or replace).
 */
function getSchemaFieldNames(def: TemplateWithSchema | undefined): string[] {
	const schema = def?.paramsSchema as ModalSchemaWithFields | undefined;
	const fields = schema?.fields;
	if (!Array.isArray(fields)) return [];
	return fields
		.map((f) => String(f.name ?? "").trim())
		.filter((n) => n.length > 0);
}

function normalizeString(v: unknown): string {
	const str = toSafeString(v);
	return typeof str === "string" ? str.trim() : "";
}

function computeAutoMappedParams(
	source: Record<string, unknown>,
	destTemplateDef: TemplateWithSchema | undefined
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
	sequence: Sequence;
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

	const editor = (view as MarkdownView & {
		editor?: MinimalEditorForReplace;
	}).editor;

	if (!editor) {
		// No active editor available; nothing to do.
		return;
	}

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
		| TemplateWithSchema
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
	let finalParams: Record<string, unknown> = { ...(baseParams ?? {}) };

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
				fields: missingSchema.fields.map((f) => {
					const fromFinal =
						f.name != null ? toSafeString(finalParams[f.name]) : undefined;
					const fromDefault = hasDefaultValue(f)
						? toSafeString(f.defaultValue)
						: undefined;

					return {
						...f,
						defaultValue: fromFinal ?? fromDefault,
					};
				}),
			},
			false
		);
		if (collected) finalParams = { ...finalParams, ...collected };
	}

	// 4) Render only the inner content (wrapper is unchanged)
	const newInnerHtml = renderTemplateOnly(targetTemplate, finalParams);

	// 5) Replace the wrapper inner HTML in the current line via templating-engine helper
	await replaceTemplateWrapperOnCurrentLine(
		app,
		view,
		editor,
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
 * Replace a wrapper on the specified file and line, aligning behavior with the editor path.
 *
 * Key changes:
 * - Replace the ENTIRE wrapper region (opening <span ...> through its matching </span>),
 *   not just the inner HTML. This aligns the custom view overwrite with the regular note behavior
 *   and prevents nested wrappers or trailing leftovers.
 * - Use a simple nesting-aware scan to find the correct closing span, so nested <span> tags
 *   inside the wrapper do not confuse the replacement.
 * - Prefer matching by instanceId when provided; fall back to matching by data-template-key.
 */
async function replaceWrapperInnerHtmlOnFileLine(params: {
	app: App;
	filePath: string;
	line0?: number | null;
	instanceId?: string | null;
	templateKey: string;
	newInnerHtml: string; // May be a full wrapper; we now replace the entire wrapper region with this markup.
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

		// Anchor preference: instanceId > key
		let anchorPos = -1;
		if (idStr) {
			const reId = new RegExp(idStr);
			anchorPos = line.search(reId);
		}
		if (anchorPos < 0) {
			const reKey = new RegExp(keyStr);
			anchorPos = line.search(reKey);
		}
		// Could not find anything in this line
		if (anchorPos < 0) return { changed: false, out: line };

		// Find the opening <span ...> that contains our anchor
		const openStart = line.lastIndexOf("<span", anchorPos);
		if (openStart < 0) return { changed: false, out: line };
		const openEnd = line.indexOf(">", openStart);
		if (openEnd < 0) return { changed: false, out: line };

		// Sanity: ensure this opening tag has the template key attribute
		const openTag = line.slice(openStart, openEnd + 1);
		const openHasKey = new RegExp(keyStr, "i").test(openTag);
		if (!openHasKey) return { changed: false, out: line };

		// Walk forward to find the matching closing </span> for this wrapper, accounting for nested spans
		let idx = openEnd + 1;
		let depth = 1;
		let closeStart = -1;
		let closeEnd = -1;

		while (idx < line.length) {
			const nextOpen = line.indexOf("<span", idx);
			const nextClose = line.indexOf("</span>", idx);

			if (nextClose === -1) {
				// Malformed or multi-line wrapper; bail to avoid corruption
				return { changed: false, out: line };
			}

			if (nextOpen !== -1 && nextOpen < nextClose) {
				// Another nested <span> before the next close
				depth++;
				idx = nextOpen + 5; // move past "<span"
			} else {
				// We encountered a closing span
				depth--;
				closeStart = nextClose;
				closeEnd = nextClose + "</span>".length;
				idx = closeEnd;
				if (depth === 0) break;
			}
		}

		if (depth !== 0 || closeStart < 0 || closeEnd < 0) {
			// Could not find a proper matching closing tag
			return { changed: false, out: line };
		}

		// Replace the ENTIRE wrapper (from openStart to closeEnd) with new markup
		const before = line.slice(0, openStart);
		const after = line.slice(closeEnd);
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
	sequence: Sequence;
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
		| TemplateWithSchema
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
	let finalParams: Record<string, unknown> = { ...(baseParams ?? {}) };

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
				fields: missingSchema.fields.map((f) => {
					const fromFinal =
						f.name != null ? toSafeString(finalParams[f.name]) : undefined;
					const fromDefault = hasDefaultValue(f)
						? toSafeString(f.defaultValue)
						: undefined;

					return {
						...f,
						defaultValue: fromFinal ?? fromDefault,
					};
				}),
			},
			false
		);
		if (collected) finalParams = { ...finalParams, ...collected };
	}

	// 6) Render inner HTML only (may be full wrapper depending on engine; we replace entire wrapper region below)
	const newInnerHtml = renderTemplateOnly(targetTemplate, finalParams);

	// 7) Replace in file by replacing the entire wrapper region on the hinted line (fallback to scan)
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
	forward: Sequence[];
	backward: Sequence[]; // reversible items where clicked is the target
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