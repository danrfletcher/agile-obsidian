/**
 * Templating Sequencer - CRM Presets
 *
 * Predefined sequences for CRM templates with type-safe variable mapping.
 * You can expand/modify these as needed. The mapping defaults are conservative;
 * the Additional Properties modal will collect any required fields absent in the mapping output.
 */

import type { Sequence } from "./types";

// Local param types for clarity and type-safety
type MoneyParams = {
	currency?: string; // "$", "€", etc. (string because UI provides string)
	paidAmount?: string; // "1250.00"
	totalAmount?: string; // "5000.00"
};

type PaymentPlanParams = MoneyParams & {
	months?: string; // e.g., "6"
	endDate?: string; // "YYYY-MM-DD"
};

// CRM template keys (must match templating-engine presets)
const CRM = {
	awaitingDeposit: "crm.awaitingDeposit",
	depositPaid: "crm.depositPaid",
	paymentPlan: "crm.paymentPlan",
	paidInFull: "crm.paidInFull",
} as const;

/**
 * Helper: For moves that imply "mark as fully paid", default paidAmount to totalAmount if present.
 */
function markPaidInFullDefaults(p: MoneyParams): MoneyParams {
	const total = (p.totalAmount ?? "").trim();
	const paid = (p.paidAmount ?? "").trim();
	return {
		...p,
		paidAmount: total || paid || p.paidAmount, // prioritize total when present
	};
}

export const presetSequences: Array<Sequence<any, any>> = [
	// awaitingDeposit <-> depositPaid
	{
		id: "crm:awaiting->depositPaid",
		startTemplate: CRM.awaitingDeposit,
		targetTemplate: CRM.depositPaid,
		direction: "both",
		variableMap: {
			// No known values on awaitingDeposit; prompt for all depositPaid params
			forward: async () => ({} as MoneyParams),
			backward: async () => ({} as Record<string, never>), // awaitingDeposit has no params
		},
	},

	// awaitingDeposit <-> paymentPlan
	{
		id: "crm:awaiting->paymentPlan",
		startTemplate: CRM.awaitingDeposit,
		targetTemplate: CRM.paymentPlan,
		direction: "both",
		variableMap: {
			forward: async () => ({} as PaymentPlanParams),
			backward: async () => ({} as Record<string, never>),
		},
	},

	// awaitingDeposit <-> paidInFull
	{
		id: "crm:awaiting->paidInFull",
		startTemplate: CRM.awaitingDeposit,
		targetTemplate: CRM.paidInFull,
		direction: "both",
		variableMap: {
			forward: async () => ({} as MoneyParams),
			backward: async () => ({} as Record<string, never>),
		},
	},

	// depositPaid <-> paymentPlan
	{
		id: "crm:depositPaid->paymentPlan",
		startTemplate: CRM.depositPaid,
		targetTemplate: CRM.paymentPlan,
		direction: "both",
		variableMap: {
			forward: async ({ start }) => {
				const p = start as MoneyParams;
				// Carry currency/amounts; prompt for months/endDate if absent
				return {
					currency: p.currency,
					paidAmount: p.paidAmount,
					totalAmount: p.totalAmount,
					// months/endDate will be requested if missing
				} as PaymentPlanParams;
			},
			backward: async ({ target }) => {
				const t = target as PaymentPlanParams;
				// Carry currency/amounts back to depositPaid
				return {
					currency: t.currency,
					paidAmount: t.paidAmount,
					totalAmount: t.totalAmount,
				} as MoneyParams;
			},
		},
	},

	// depositPaid <-> paidInFull
	{
		id: "crm:depositPaid->paidInFull",
		startTemplate: CRM.depositPaid,
		targetTemplate: CRM.paidInFull,
		direction: "both",
		variableMap: {
			forward: async ({ start }) => {
				// Default paidAmount to totalAmount to mark fully paid; user can override in modal
				return markPaidInFullDefaults(start as MoneyParams);
			},
			backward: async ({ target }) => {
				// Back to depositPaid; preserve currency and amounts
				return {
					currency: (target as MoneyParams).currency,
					paidAmount: (target as MoneyParams).paidAmount,
					totalAmount: (target as MoneyParams).totalAmount,
				} as MoneyParams;
			},
		},
	},

	// paymentPlan <-> paidInFull
	{
		id: "crm:paymentPlan->paidInFull",
		startTemplate: CRM.paymentPlan,
		targetTemplate: CRM.paidInFull,
		direction: "both",
		variableMap: {
			forward: async ({ start }) => {
				// Carry amounts; default to fully paid
				const p = start as PaymentPlanParams;
				return markPaidInFullDefaults({
					currency: p.currency,
					paidAmount: p.paidAmount,
					totalAmount: p.totalAmount,
				});
			},
			backward: async ({ target }) => {
				const t = target as MoneyParams;
				// Back to paymentPlan; months/endDate will be prompted if absent
				return {
					currency: t.currency,
					paidAmount: t.paidAmount,
					totalAmount: t.totalAmount,
				} as PaymentPlanParams;
			},
		},
	},
];
