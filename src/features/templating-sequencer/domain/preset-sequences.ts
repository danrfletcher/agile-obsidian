/**
 * Templating Sequencer - CRM Presets
 *
 * Defaults in the sequencer-service automatically:
 *  - pass through shared-named variables,
 *  - prompt for missing target-only fields,
 *  - drop source-only fields.
 * You can still add variableMapOverrides per sequence when a transformation is needed.
 */

import type { Sequence } from "./types";

// CRM template keys (must match templating-engine presets)
const CRM = {
	awaitingDeposit: "crm.awaitingDeposit",
	depositPaid: "crm.depositPaid",
	paymentPlan: "crm.paymentPlan",
	paidInFull: "crm.paidInFull",
} as const;

export const presetSequences: Array<Sequence<any, any>> = [
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
];
