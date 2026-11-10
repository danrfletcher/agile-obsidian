import { presetTemplates } from "./presets";
import type { TemplateDefinition } from "./types";

let cached: Set<string> | null = null;

function ids(): Set<string> {
	if (cached) return cached;
	const set = new Set<string>();
	const groups = presetTemplates as unknown as Record<
		string,
		Record<string, TemplateDefinition>
	>;
	for (const defs of Object.values(groups)) {
		for (const def of Object.values(defs)) set.add(def.id);
	}
	cached = set;
	return set;
}

/** The exact ids of all built-in templates (the Default set), in preset order. */
export function listBuiltInTemplateIds(): string[] {
	return Array.from(ids());
}

/**
 * True only for an exact built-in template id. Unlike the registry's tolerant lookup
 * this never matches by last segment or by substring, so it is safe for deciding
 * whether a chip key may be interpreted by name (artefact type, I5).
 */
export function isBuiltInTemplateId(id: string): boolean {
	return ids().has(id);
}
