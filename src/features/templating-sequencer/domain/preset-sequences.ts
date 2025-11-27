/**
 * Templating Sequencer - Preset + Dynamic Sequences
 *
 * Defaults in the sequencer-service automatically:
 *  - pass through shared-named variables,
 *  - prompt for missing target-only fields,
 *  - drop source-only fields.
 * You can still add variableMapOverrides per sequence when a transformation is needed.
 *
 * This file now also dynamically generates forward-only sequences between any two
 * templates that:
 *  - are not hiddenFromDynamicCommands,
 *  - have at least 1 parameter, and
 *  - have identical parameter name sets.
 *
 * Users can override or disable these dynamic sequences by defining explicit sequences below:
 *  - If a manual sequence with the same start->target exists and is not disabled, it overrides the dynamic one.
 *  - If a manual sequence exists with disabled: true, it blocks the dynamic one and is not included in the final list.
 */

import type { Sequence } from "./types";
// Import the full preset templates registry to inspect params and flags for auto-generation
import { presetTemplates } from "@features/templating-engine/domain/presets";

// CRM template keys (must match templating-engine presets)
const CRM = {
	awaitingDeposit: "crm.awaitingDeposit",
	depositPaid: "crm.depositPaid",
	paymentPlan: "crm.paymentPlan",
	paidInFull: "crm.paidInFull",
} as const;

/**
 * Manually defined sequences (overrides and CRM presets).
 * To disable an auto-generated sequence, define it here with disabled: true.
 */
const manualSequences: Sequence[] = [
	// awaitingDeposit <-> depositPaid
	{
		id: "crm:awaiting->depositPaid",
		startTemplate: CRM.awaitingDeposit,
		targetTemplate: CRM.depositPaid,
		direction: "both",
	},

	// awaitingDeposit <-> paymentPlan
	{
		id: "crm:awaiting->paymentPlan",
		startTemplate: CRM.awaitingDeposit,
		targetTemplate: CRM.paymentPlan,
		direction: "both",
	},

	// awaitingDeposit <-> paidInFull
	{
		id: "crm:awaiting->paidInFull",
		startTemplate: CRM.awaitingDeposit,
		targetTemplate: CRM.paidInFull,
		direction: "both",
	},

	// depositPaid <-> paymentPlan
	{
		id: "crm:depositPaid->paymentPlan",
		startTemplate: CRM.depositPaid,
		targetTemplate: CRM.paymentPlan,
		direction: "both",
	},

	// depositPaid <-> paidInFull
	{
		id: "crm:depositPaid->paidInFull",
		startTemplate: CRM.depositPaid,
		targetTemplate: CRM.paidInFull,
		direction: "both",
	},

	// paymentPlan <-> paidInFull
	{
		id: "crm:paymentPlan->paidInFull",
		startTemplate: CRM.paymentPlan,
		targetTemplate: CRM.paidInFull,
		direction: "both",
	},

	// Example of how to disable an auto-generated sequence (uncomment to use):
	// {
	// 	id: "disable:auto:agile.feature->agile.product",
	// 	startTemplate: "agile.feature",
	// 	targetTemplate: "agile.product",
	// 	direction: "forwards",
	// 	disabled: true,
	// },
];

/**
 * Helpers to inspect template definitions from presetTemplates.
 */
type AnyTemplateDef = {
	id: string;
	label?: string;
	hasParams?: boolean;
	paramsSchema?: {
		fields?: Array<{ name?: string }>;
	};
	hiddenFromDynamicCommands?: boolean;
};

// Flatten groups (agile, crm, members, prioritization, workflows, obsidian)
function collectAllTemplateDefs(): AnyTemplateDef[] {
	const out: AnyTemplateDef[] = [];
	if (!presetTemplates) return out;

	for (const group of Object.values(presetTemplates)) {
		for (const def of Object.values(group)) {
			out.push(def);
		}
	}
	return out;
}

function getParamNames(def: AnyTemplateDef): string[] {
	const fields = def?.paramsSchema?.fields;
	if (!Array.isArray(fields) || fields.length === 0) return [];
	const names = fields
		.map((f) => String(f?.name ?? "").trim())
		.filter((n) => n.length > 0);
	// dedupe + sort for stable comparison
	return Array.from(new Set(names)).sort((a, b) =>
		a < b ? -1 : a > b ? 1 : 0
	);
}

function isEligibleForDynamic(def: AnyTemplateDef): boolean {
	if (def?.hiddenFromDynamicCommands) return false;
	const names = getParamNames(def);
	return def?.hasParams === true && names.length > 0;
}

/**
 * Generate forward-only dynamic sequences between any two eligible templates
 * sharing identical param name sets.
 */
function generateDynamicSequences(): Sequence[] {
	const defs = collectAllTemplateDefs();
	const eligible = defs.filter(isEligibleForDynamic).map((d) => ({
		id: d.id,
		paramNames: getParamNames(d),
	}));

	// Group by identical param name signature
	const signatureMap = new Map<string, string[]>(); // signature -> template ids
	for (const e of eligible) {
		const sig = e.paramNames.join("|");
		const list = signatureMap.get(sig) ?? [];
		list.push(e.id);
		signatureMap.set(sig, list);
	}

	const dynamic: Sequence[] = [];

	// For each group with >= 2 templates, create forward-only sequences between all ordered pairs
	for (const [, ids] of signatureMap) {
		if (ids.length < 2) continue;
		for (let i = 0; i < ids.length; i++) {
			for (let j = 0; j < ids.length; j++) {
				if (i === j) continue;
				const start = ids[i];
				const target = ids[j];
				dynamic.push({
					id: `auto:${start}->${target}`,
					startTemplate: start,
					targetTemplate: target,
					direction: "forwards",
				});
			}
		}
	}

	return dynamic;
}

/**
 * Merge manual and dynamic sequences with the following rules:
 * - If a manual sequence (same start->target) exists and is not disabled, it overrides and replaces the dynamic one.
 * - If a manual sequence exists with disabled: true, we exclude both the manual (disabled) and the dynamic one for that pair.
 * - Otherwise we include the dynamic sequence.
 */
function mergeSequences(
	manual: Sequence[],
	autoGen: Sequence[]
): Sequence[] {
	// Key = "start->target"
	const keyOf = (s: Sequence) => `${s.startTemplate}->${s.targetTemplate}`;

	const manualByKey = new Map<string, Sequence>();
	const disabledKeys = new Set<string>();

	for (const m of manual) {
		const k = keyOf(m);
		manualByKey.set(k, m);
		if (m.disabled === true) {
			disabledKeys.add(k);
		}
	}

	const out: Sequence[] = [];

	// 1) Include manual sequences that are not disabled
	for (const m of manual) {
		if (m.disabled === true) continue;
		out.push(m);
	}

	// 2) Include auto sequences when not overridden or disabled
	for (const a of autoGen) {
		const k = keyOf(a);
		if (disabledKeys.has(k)) continue; // user explicitly disabled this pair
		if (manualByKey.has(k)) continue; // manual override already included
		out.push(a);
	}

	return out;
}

const dynamicSequences = generateDynamicSequences();
export const presetSequences: Sequence[] = mergeSequences(
	manualSequences,
	dynamicSequences
);