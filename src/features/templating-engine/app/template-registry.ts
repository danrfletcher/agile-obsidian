/**
 * Template registry: the one live list of available templates.
 *
 * It holds the built-in templates (the "Default templates" set, switchable) plus a hook
 * for custom definitions (`setCustomDefinitions`). Every consumer (insert commands,
 * lookups, sequence generation, the sequencer's eligible set, edit and repeat) reads the
 * registry at the time it needs an answer instead of capturing a module-load constant.
 *
 * - Built-ins come from the in-memory presets only. Nothing here scans the vault.
 * - Switching the set only changes what is *active*. Chips already in notes are never
 *   touched by anything in this module.
 * - `version` and `onChange` signal real changes only: setting the same flag value, or
 *   the same custom definitions, again is a no-op and fires nothing.
 */

import { presetTemplates } from "../domain/presets";
import type { TemplateDefinition } from "../domain/types";

type Group = Record<string, TemplateDefinition>;

export interface TemplateRegistry {
	/** Built-ins (only while the default set is on) followed by custom definitions. */
	listActiveTemplates(): TemplateDefinition[];
	/** Resolves only templates that are active right now. Used by insert/edit/sequence/repeat. */
	findActiveTemplate(id: string): TemplateDefinition | undefined;
	/** Resolves any known template, active or not. Only for label fallbacks. */
	findAnyTemplate(id: string): TemplateDefinition | undefined;
	/** All built-ins regardless of the flag, in preset order. */
	listBuiltInTemplates(): TemplateDefinition[];
	/** True when `id` resolves to a built-in (regardless of the flag). */
	isBuiltInId(id: string): boolean;
	/** Replace the custom definitions (PR-5 calls this). */
	setCustomDefinitions(defs: readonly TemplateDefinition[]): void;
	setDefaultTemplatesEnabled(enabled: boolean): void;
	isDefaultTemplatesEnabled(): boolean;
	/** Increments on every real change. */
	getVersion(): number;
	/** Subscribe to real changes; returns an unsubscribe function. */
	onChange(listener: () => void): () => void;
}

/** All built-ins, flattened in preset order (group order, then key order). */
function flattenBuiltIns(): TemplateDefinition[] {
	const groups = presetTemplates as unknown as Record<string, Group>;
	const out: TemplateDefinition[] = [];
	for (const defs of Object.values(groups)) {
		for (const def of Object.values(defs)) out.push(def);
	}
	return out;
}

/**
 * Robust built-in resolver that supports:
 * - Canonical "group.key" lookups (fast-path).
 * - Multi-dot ids like "workflows.states.blocked" by matching against def.id.
 * - Fallback to using the last segment as the key within the group.
 * - As a final fallback, scans all groups for a def with a matching def.id.
 */
function resolveBuiltIn(id: string): TemplateDefinition | undefined {
	if (!id) return undefined;

	const firstDot = id.indexOf(".");
	const group = firstDot >= 0 ? id.slice(0, firstDot) : id;

	const groups = presetTemplates as unknown as Record<string, Group>;
	const groupObj = Object.prototype.hasOwnProperty.call(groups, group)
		? groups[group]
		: undefined;

	if (groupObj) {
		// 1) exact "group.remainder", where remainder may contain dots (e.g. "states.blocked")
		const remainder =
			firstDot >= 0 && firstDot + 1 < id.length ? id.slice(firstDot + 1) : "";
		if (remainder && groupObj[remainder]) return groupObj[remainder];

		// 2) last segment within the group (e.g. key "blocked")
		const parts = id.split(".");
		const last = parts[parts.length - 1];
		if (last && groupObj[last]) return groupObj[last];

		// 3) exact def.id match within the group
		for (const def of Object.values(groupObj)) {
			if (def?.id === id) return def;
		}
	}

	// 4) final fallback: scan all groups by def.id
	for (const defs of Object.values(groups)) {
		for (const def of Object.values(defs)) {
			if (def?.id === id) return def;
		}
	}
	return undefined;
}

function sameDefinitions(
	a: readonly TemplateDefinition[],
	b: readonly TemplateDefinition[]
): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

export function createTemplateRegistry(): TemplateRegistry {
	const builtIns = flattenBuiltIns();
	let custom: TemplateDefinition[] = [];
	let customById = new Map<string, TemplateDefinition>();
	let defaultsEnabled = true;
	let version = 0;
	const listeners = new Set<() => void>();

	const changed = () => {
		version += 1;
		// Copy: a listener may unsubscribe (or subscribe) while we notify.
		for (const l of Array.from(listeners)) {
			try {
				l();
			} catch (err) {
				globalThis.console?.error?.(
					"[template-registry] change listener failed",
					err
				);
			}
		}
	};

	return {
		listActiveTemplates() {
			return defaultsEnabled ? [...builtIns, ...custom] : [...custom];
		},
		findActiveTemplate(id) {
			if (!id) return undefined;
			const c = customById.get(id);
			if (c) return c;
			return defaultsEnabled ? resolveBuiltIn(id) : undefined;
		},
		findAnyTemplate(id) {
			if (!id) return undefined;
			return customById.get(id) ?? resolveBuiltIn(id);
		},
		listBuiltInTemplates() {
			return [...builtIns];
		},
		isBuiltInId(id) {
			return resolveBuiltIn(id) !== undefined;
		},
		setCustomDefinitions(defs) {
			if (sameDefinitions(custom, defs)) return;
			custom = [...defs];
			customById = new Map(custom.map((d) => [d.id, d]));
			changed();
		},
		setDefaultTemplatesEnabled(enabled) {
			const next = !!enabled;
			if (next === defaultsEnabled) return;
			defaultsEnabled = next;
			changed();
		},
		isDefaultTemplatesEnabled() {
			return defaultsEnabled;
		},
		getVersion() {
			return version;
		},
		onChange(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

/** The plugin-wide registry instance. */
export const templateRegistry: TemplateRegistry = createTemplateRegistry();

export const listActiveTemplates = (): TemplateDefinition[] =>
	templateRegistry.listActiveTemplates();
export const findActiveTemplate = (
	id: string
): TemplateDefinition | undefined => templateRegistry.findActiveTemplate(id);
export const findAnyTemplate = (id: string): TemplateDefinition | undefined =>
	templateRegistry.findAnyTemplate(id);
export const setCustomDefinitions = (
	defs: readonly TemplateDefinition[]
): void => templateRegistry.setCustomDefinitions(defs);
export const setDefaultTemplatesEnabled = (enabled: boolean): void =>
	templateRegistry.setDefaultTemplatesEnabled(enabled);
export const isDefaultTemplatesEnabled = (): boolean =>
	templateRegistry.isDefaultTemplatesEnabled();
export const getRegistryVersion = (): number => templateRegistry.getVersion();
export const onTemplateRegistryChange = (listener: () => void): (() => void) =>
	templateRegistry.onChange(listener);
