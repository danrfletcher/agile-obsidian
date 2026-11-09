/**
 * Custom templates: loader and `reloadCustomTemplates()`.
 *
 * Settings hold one raw JSON text per card (`customTemplates: string[]`, in card order).
 * This module turns those texts into definitions in the live template registry:
 *
 * - each card is validated by the pure validator (G13/G14); an invalid card is skipped, the
 *   others load. A card whose id equals a built-in id or an earlier loaded card's id is an
 *   error on that later card and is not loaded (E1).
 * - the registry's change notification then does the rest with no plugin reload: the
 *   insert commands are added/removed/renamed (`Plugin.removeCommand`), and the sequences,
 *   the sequence index and the sequencer's eligible set are rebuilt lazily from the new
 *   active list.
 * - nothing from settings is ever executed: the texts are parsed as JSON and the pattern is
 *   read by a tokenizer (F3).
 *
 * Calling `reloadCustomTemplates()` again with the same settings changes nothing: unchanged
 * definitions are reused by identity, so the registry sees no change.
 */

import type { TemplateDefinition } from "../domain/types";
import {
	validateCustomTemplateText,
	type CustomTemplateSpec,
} from "../domain/custom-template-schema";
import { buildCustomTemplateDefinition } from "../domain/custom-template-render";
import { listBuiltInTemplateIds } from "../domain/built-in-ids";
import { templateRegistry } from "./template-registry";

export interface CustomTemplateCardResult {
	/** Card position in the settings array. */
	index: number;
	loaded: boolean;
	/** Template id when the card parsed far enough to have one. */
	id?: string;
	/** Display strings ("path: message"); empty when loaded. */
	errors: string[];
}

export interface CustomTemplatesLoad {
	definitions: TemplateDefinition[];
	specs: CustomTemplateSpec[];
	cards: CustomTemplateCardResult[];
}

/**
 * Validate every card in order and build the definitions of the valid ones.
 * `builtInIds` are ids no custom template may use.
 */
export function loadCustomTemplates(
	texts: readonly unknown[],
	builtInIds: readonly string[]
): CustomTemplatesLoad {
	const taken = [...builtInIds];
	const definitions: TemplateDefinition[] = [];
	const specs: CustomTemplateSpec[] = [];
	const cards: CustomTemplateCardResult[] = [];

	texts.forEach((text, index) => {
		if (typeof text !== "string") {
			cards.push({ index, loaded: false, errors: ["not a string"] });
			return;
		}
		if (text.trim() === "") {
			// An empty card loads nothing and is not an error.
			cards.push({ index, loaded: false, errors: [] });
			return;
		}
		const v = validateCustomTemplateText(text, taken);
		if (!v.ok || !v.spec) {
			cards.push({ index, loaded: false, errors: v.messages });
			return;
		}
		taken.push(v.spec.id);
		specs.push(v.spec);
		definitions.push(buildCustomTemplateDefinition(v.spec));
		cards.push({ index, loaded: true, id: v.spec.id, errors: [] });
	});

	return { definitions, specs, cards };
}

/**
 * The ids card `index` may not use: every built-in id plus the ids of the cards before it
 * that load. For live validation feedback: `validateCustomTemplateText(texts[i],
 * getOtherTemplateIdsForCard(texts, i))` agrees with what the loader will do.
 */
export function getOtherTemplateIdsForCard(
	texts: readonly unknown[],
	index: number,
	builtInIds: readonly string[] = listBuiltInTemplateIds()
): string[] {
	const earlier = loadCustomTemplates(texts.slice(0, index), builtInIds);
	return [...builtInIds, ...earlier.specs.map((s) => s.id)];
}

type Source = () => readonly unknown[];
let source: Source | null = null;

// Definitions from the previous load, by id, keyed by the spec they were built from.
let previous = new Map<string, { key: string; def: TemplateDefinition }>();

/** Where `reloadCustomTemplates()` reads the card texts from (the live settings). */
export function setCustomTemplateSource(provider: Source | null): void {
	source = provider;
}

/**
 * Rebuild the custom templates in the live registry from the saved card texts.
 * No plugin reload is needed. Returns what happened to each card.
 */
export function reloadCustomTemplates(): CustomTemplatesLoad {
	const raw = source ? source() : [];
	const texts = Array.isArray(raw) ? raw : [];
	const load = loadCustomTemplates(texts, listBuiltInTemplateIds());

	// Reuse an unchanged definition so the registry's identity check sees "no change".
	const next = new Map<string, { key: string; def: TemplateDefinition }>();
	const definitions = load.specs.map((spec, i) => {
		const key = JSON.stringify(spec);
		const before = previous.get(spec.id);
		const def = before && before.key === key ? before.def : load.definitions[i];
		next.set(spec.id, { key, def });
		return def;
	});
	previous = next;

	templateRegistry.setCustomDefinitions(definitions);
	return { ...load, definitions };
}

/** Plugin unload: forget the source and remove every custom template from the registry. */
export function disposeCustomTemplates(): void {
	source = null;
	previous = new Map();
	templateRegistry.setCustomDefinitions([]);
}
