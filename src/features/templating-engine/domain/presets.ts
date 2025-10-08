import tokensData from "./tokens.json";
import { markChip, wrapTemplate } from "../ui/html-partials";
import type { TemplateDefinition } from "./types";
import {
	wrapVar,
	extractParamsFromWrapperEl,
	attrVar,
} from "./template-parameter-helpers";
import { artifactOptions, currencyDropdownOptions } from "../app/constants";

// Derive from JSON
const colors = tokensData.colors as Record<string, string>;
const emojis = tokensData.emojis as Record<string, string>;

// Utility to build a mark chip without any numeric order (order is dropped)
function chip(opts: {
	id: string;
	text: string;
	bg?: string;
	color?: string;
	bold?: boolean;
	href?: string;
	kind?: string;
	extraAttrs?: Record<string, string | number | boolean | undefined>;
}): string {
	const { id, text, bg, color, bold, href, kind, extraAttrs } = opts;
	return markChip({
		id,
		text,
		bg,
		color,
		bold,
		href,
		kind,
		extraAttrs,
	});
}

/**
 * Agile Artifacts — tasks only
 * orderTag: "artifact-item-type", except Parent Link which is "parent-link"
 */
export const Agile: Record<string, TemplateDefinition<any>> = {
	initiative: {
		orderTag: "artifact-item-type",
		id: "agile.initiative",
		label: "Agile - Initiative",
		hasParams: true,
		paramsSchema: {
			title: "Create Initiative",
			titles: { create: "Create Initiative", edit: "Edit Initiative" },
			description:
				"Provide a title and optional details for the initiative.",
			fields: [
				{
					name: "title",
					label: "Title",
					required: true,
					placeholder: "e.g., Unified Billing Platform",
				},
				{
					name: "details",
					label: "Details",
					type: "textarea",
					placeholder: "Optional details...",
				},
			],
		},
		rules: { allowedOn: ["task"] },
		render(params: { title: string; details?: string }) {
			const title = params?.title?.trim() ?? "";
			const details = params?.details?.trim() ?? "";

			const text = `<strong>${emojis.initiative} ${wrapVar(
				"title",
				title
			)}</strong>${details ? `:` : ""}`;

			const inner = `${chip({
				id: "agile-initiative",
				text,
				bg: colors.artifactGrey,
			})}${details ? ` ${wrapVar("details", details)}` : ""}`;

			return wrapTemplate("agile.initiative", inner, {
				orderTag: this.orderTag,
			});
		},
	},

	epic: {
		orderTag: "artifact-item-type",
		id: "agile.epic",
		label: "Agile - Epic",
		hasParams: true,
		paramsSchema: {
			titles: { create: "Create Epic", edit: "Edit Epic" },
			description: "Provide a title and optional details for the epic.",
			fields: [
				{
					name: "title",
					label: "Title",
					required: true,
					placeholder: "e.g., Payment Gateway Integration",
				},
				{
					name: "details",
					label: "Details",
					type: "textarea",
					placeholder: "Optional details...",
				},
			],
		},
		rules: { allowedOn: ["task"] },
		render(params?: { title?: string; details?: string }) {
			const title = params?.title?.trim() ?? "";
			const details = params?.details?.trim() ?? "";
			const text = `<strong>${emojis.epic} ${wrapVar("title", title)}${
				details ? ":" : ""
			}</strong>`;
			const inner = `${chip({
				id: "agile-epic",
				text,
				bg: colors.artifactGrey,
			})}${details ? ` ${wrapVar("details", details)}` : ""}`;
			return wrapTemplate("agile.epic", inner, {
				orderTag: this.orderTag,
			});
		},
	},

	feature: {
		orderTag: "artifact-item-type",
		id: "agile.feature",
		label: "Agile - Feature",
		hasParams: true,
		paramsSchema: {
			title: "Create Feature",
			titles: { create: "Create Feature", edit: "Edit Feature" },
			description:
				"Provide a title and optional details for the feature.",
			fields: [
				{
					name: "title",
					label: "Title",
					required: true,
					placeholder: "e.g., SSO with SAML",
				},
				{
					name: "details",
					label: "Details",
					type: "textarea",
					placeholder: "Optional details...",
				},
			],
		},
		rules: { allowedOn: ["task"] },
		render(params: { title: string; details?: string }) {
			const title = params?.title?.trim() ?? "";
			const details = params?.details?.trim() ?? "";
			const text = `<strong>${emojis.feature} ${wrapVar(
				"title",
				title
			)}</strong>${details ? `:` : ""}`;
			const inner = `${chip({
				id: "agile-feature",
				text,
				bg: colors.artifactGrey,
			})}${details ? ` ${wrapVar("details", details)}` : ""}`;
			return wrapTemplate("agile.feature", inner, {
				orderTag: this.orderTag,
			});
		},
	},

	product: {
		orderTag: "artifact-item-type",
		id: "agile.product",
		label: "Agile - Product",
		rules: { allowedOn: ["task"] },
		render(params?: { title?: string; details?: string }) {
			const title = params?.title?.trim() ?? "";
			const details = params?.details?.trim() ?? "";
			const main = title
				? `<strong>${emojis.product} ${title}${
						details ? ":" : ""
				  }</strong>`
				: `<strong>${emojis.product} </strong>`;
			const tail = details ? ` ${details}` : "";
			const inner = chip({
				id: "agile-product",
				text: `${main}${tail}`,
				bg: colors.artifactGrey,
			});
			return wrapTemplate("agile.product", inner, {
				orderTag: this.orderTag,
			});
		},
	},

	userStory: {
		orderTag: "artifact-item-type",
		id: "agile.userStory",
		label: "Agile - User Story",
		hasParams: true,
		paramsSchema: {
			title: "Create User Story",
			titles: { create: "Create User Story", edit: "Edit User Story" },
			description:
				"Provide the story title. Optionally add persona, desire, and outcome to auto-generate the ‘As a / I want / so that’ clause.",
			fields: [
				{
					name: "title",
					label: "Title",
					required: true,
					placeholder: "e.g., Login",
				},
				{
					name: "persona",
					label: "Persona",
					placeholder: "e.g., Registered user",
				},
				{
					name: "desire",
					label: "Desire",
					placeholder: "e.g., log in to the site",
				},
				{
					name: "outcome",
					label: "Outcome",
					placeholder: "e.g., access my dashboard",
				},
			],
		},
		rules: { allowedOn: ["task"] },

		// Marker-only: rely solely on [data-tpl-var] markers
		parseParamsFromDom(wrapperEl) {
			return extractParamsFromWrapperEl(wrapperEl);
		},

		render(params: {
			title: string;
			persona?: string;
			desire?: string;
			outcome?: string;
		}) {
			const title = params?.title?.trim() ?? "";
			const persona = params?.persona?.trim() ?? "";
			const desire = params?.desire?.trim() ?? "";
			const outcome = params?.outcome?.trim() ?? "";

			const hasClause = !!(persona && desire && outcome);
			const clause = hasClause
				? ` <strong>As a</strong> ${wrapVar(
						"persona",
						persona
				  )}, <strong>I want to</strong> ${wrapVar(
						"desire",
						desire
				  )}, <strong>so that</strong> ${wrapVar("outcome", outcome)}`
				: "";

			const text = `<strong>${emojis.story} ${wrapVar("title", title)}${
				hasClause ? ":" : ""
			}</strong>`;

			const inner = `${chip({
				id: "agile-user-story",
				text,
				bg: `linear-gradient(to right, ${colors.userStoryFrom}, ${colors.userStoryTo})`,
			})}${clause ? ` ${clause}` : ""}`;

			return wrapTemplate("agile.userStory", inner, {
				orderTag: this.orderTag,
			});
		},
	},

	acceptanceCriteria: {
		orderTag: "artifact-item-type",
		id: "agile.acceptanceCriteria",
		label: "Agile - Acceptance Criteria",
		hasParams: true,
		paramsSchema: {
			title: "Add Acceptance Criteria",
			fields: [
				{
					name: "title",
					label: "Title",
					required: true,
					placeholder: "e.g., Success path",
				},
				{
					name: "details",
					label: "Details",
					type: "textarea",
					placeholder: "Optional details…",
				},
			],
		},
		rules: { allowedOn: ["task"] },
		render(params: { title: string; details?: string }) {
			const title = params?.title?.trim() ?? "";
			const details = params?.details?.trim() ?? "";
			const text = `<strong>${emojis.accept} ${wrapVar(
				"title",
				title
			)}</strong>${details ? `:` : ""}`;
			const inner = `${chip({
				id: "agile-acceptance",
				text,
				bg: colors.artifactGrey,
			})}${details ? ` ${wrapVar("details", details)}` : ""}`;
			return wrapTemplate("agile.acceptanceCriteria", inner, {
				orderTag: this.orderTag,
			});
		},
	},

	recurringResponsibility: {
		orderTag: "artifact-item-type",
		id: "agile.recurringRes",
		label: "Agile - Recurring Responsibility",
		hasParams: true,
		paramsSchema: {
			title: "Add Recurring Responsibility",
			fields: [
				{
					name: "title",
					label: "Title",
					required: true,
					placeholder: "e.g., Post Once Per Week on Social Media",
				},
				{
					name: "details",
					label: "Details",
					type: "textarea",
					placeholder: "Optional details…",
				},
			],
		},
		rules: { allowedOn: ["task"] },
		render(params: { title: string; details?: string }) {
			const title = params?.title?.trim() ?? "";
			const details = params?.details?.trim() ?? "";
			const text = `<strong>${emojis.kpi} ${wrapVar(
				"title",
				title
			)}</strong>${details ? `:` : ""}`;
			const inner = `${chip({
				id: "agile-recurring-res",
				text,
				bg: colors.artifactGrey,
			})}${details ? ` ${wrapVar("details", details)}` : ""}`;
			return wrapTemplate("agile.recurringRes", inner, {
				orderTag: this.orderTag,
			});
		},
	},

	okr: {
		orderTag: "artifact-item-type",
		id: "agile.okr",
		label: "Agile - OKR",
		hasParams: true,
		paramsSchema: {
			title: "Add OKR",
			fields: [
				{
					name: "title",
					label: "Title",
					required: true,
					placeholder: "e.g., Improve Product Activation",
				},
				{
					name: "details",
					label: "Details",
					type: "textarea",
					placeholder: "Optional details…",
				},
			],
		},
		rules: { allowedOn: ["task"] },
		render(params: { title: string; details?: string }) {
			const title = params?.title?.trim() ?? "";
			const details = params?.details?.trim() ?? "";
			const text = `<strong>${emojis.okr} ${wrapVar(
				"title",
				title
			)}</strong>${details ? `:` : ""}`;
			const inner = `${chip({
				id: "agile-okr",
				text,
				bg: `linear-gradient(to left, ${colors.okrFrom}, ${colors.okrTo})`,
			})}${details ? ` ${wrapVar("details", details)}` : ""}`;
			return wrapTemplate("agile.okr", inner, {
				orderTag: this.orderTag,
			});
		},
	},

	artifactParentLink: {
		orderTag: "parent-link",
		id: "agile.parentLink",
		label: "Agile - Artifact Parent Link",
		hasParams: true,
		paramsSchema: {
			title: "Select Parent",
			fields: [
				{
					name: "blockRef",
					label: "Parent Block Reference",
					required: true,
					type: "blockSelect",
					placeholder: "Start typing...",
				},
			],
		},
		rules: { allowedOn: ["task"] },
		render(params: { blockRef: string }) {
			const blockRef = params?.blockRef?.trim() ?? "";
			const inner = `<a class="internal-link" ${attrVar(
				"href",
				"blockRef",
				blockRef
			)}>${emojis.linkArrowUp}</a>`;
			return wrapTemplate("agile.parentLink", inner, {
				orderTag: this.orderTag,
			});
		},
	},

	personalLearningInitiative: {
		orderTag: "artifact-item-type",
		id: "agile.personalLearningInitiative",
		label: "Agile (Personal) - Learning Initiative",
		rules: { allowedOn: ["task"] },
		render(params?: { title?: string; details?: string }) {
			const title = params?.title?.trim() ?? "";
			const details = params?.details?.trim() ?? "";
			const main = title
				? `<strong>${emojis.learningGrad} ${title}${
						details ? ":" : ""
				  }</strong>`
				: `<strong>${emojis.learningGrad} </strong>`;
			const tail = details ? ` ${details}` : "";
			const inner = chip({
				id: "agile-personal-learning-initiative",
				text: `${main}${tail}`,
				bg: `linear-gradient(to right, ${colors.personalInitFrom}, ${colors.personalInitTo})`,
				color: "#FFFFFF",
			});
			return wrapTemplate("agile.personalLearningInitiative", inner, {
				orderTag: this.orderTag,
			});
		},
	},

	personalLearningEpic: {
		orderTag: "artifact-item-type",
		id: "agile.personalLearningEpic",
		label: "Agile (Personal) - Learning Epic",
		rules: { allowedOn: ["task"] },
		render(params?: { title?: string; details?: string }) {
			const title = params?.title?.trim() ?? "";
			const details = params?.details?.trim() ?? "";
			const main = title
				? `<strong>${emojis.learningBook} ${title}${
						details ? ":" : ""
				  }</strong>`
				: `<strong>${emojis.learningBook} </strong>`;
			const tail = details ? ` ${details}` : "";
			const inner = chip({
				id: "agile-personal-learning-epic",
				text: `${main}${tail}`,
				bg: `linear-gradient(to right, ${colors.personalEpicFrom}, ${colors.personalEpicTo})`,
				color: "#FFFFFF",
			});
			return wrapTemplate("agile.personalLearningEpic", inner, {
				orderTag: this.orderTag,
			});
		},
	},
};

/**
 * CRM
 */
export const CRM: Record<string, TemplateDefinition<any>> = {
	abandoned: {
		orderTag: "crm-payment",
		id: "crm.abandoned",
		label: "CRM - Abandoned",
		rules: { allowedOn: ["task"] },
		render() {
			const inner = chip({
				id: "crm-abandoned",
				text: `<strong>Abandoned</strong>`,
				bg: colors.crmAbandoned,
			});
			return wrapTemplate("crm.abandoned", inner, {
				orderTag: this.orderTag,
			});
		},
	},

	awaitingDeposit: {
		orderTag: "crm-payment",
		id: "crm.awaitingDeposit",
		label: "CRM - Awaiting Deposit",
		rules: { allowedOn: ["task"] },
		render() {
			const inner = chip({
				id: "crm-awaiting-deposit",
				text: `<strong>Awaiting Deposit</strong>`,
				bg: colors.crmAwaiting,
			});
			return wrapTemplate("crm.awaitingDeposit", inner, {
				orderTag: this.orderTag,
			});
		},
	},

	commission: {
		orderTag: "crm-commission",
		id: "crm.commission",
		label: "CRM - Commission",
		hasParams: true,
		paramsSchema: {
			title: "Commission Paid",
			titles: {
				create: "Set Commission Paid",
				edit: "Edit Commission Paid",
			},
			description: "Record the commission paid vs. total commission.",
			fields: [
				{
					name: "currency",
					label: "Currency",
					type: "dropdown",
					required: true,
					placeholder: "Select currency…",
					defaultValue: "USD",
					options: currencyDropdownOptions,
				},
				{
					name: "paidAmount",
					label: "Paid Amount",
					required: true,
					placeholder: "e.g., 1,250.00",
				},
				{
					name: "totalAmount",
					label: "Total Commission",
					required: true,
					placeholder: "e.g., 5,000.00",
				},
			],
		},
		rules: { allowedOn: ["task"] },
		render(params?: {
			currency?: string;
			paidAmount?: string;
			totalAmount?: string;
		}) {
			const currency = (params?.currency ?? "USD").trim();
			const paidAmount = (params?.paidAmount ?? "").trim();
			const totalAmount = (params?.totalAmount ?? "").trim();

			const inner = chip({
				id: "crm-commission",
				text: `<strong>Commission Paid ${wrapVar(
					"currency",
					currency
				)}${wrapVar("paidAmount", paidAmount)} / ${wrapVar(
					"currency",
					currency
				)}${wrapVar("totalAmount", totalAmount)}</strong>`,
				bg: colors.crmCommission,
			});
			return wrapTemplate("crm.commission", inner, {
				orderTag: this.orderTag,
			});
		},
	},

	depositPaid: {
		orderTag: "crm-payment",
		id: "crm.depositPaid",
		label: "CRM - Deposit Paid",
		hasParams: true,
		paramsSchema: {
			title: "Deposit Paid",
			titles: {
				create: "Record Deposit Paid",
				edit: "Edit Deposit Paid",
			},
			description: "Record the deposit paid vs. total deposit.",
			fields: [
				{
					name: "currency",
					label: "Currency",
					type: "dropdown",
					required: true,
					placeholder: "Select currency…",
					defaultValue: "USD",
					options: currencyDropdownOptions,
				},
				{
					name: "paidAmount",
					label: "Paid Amount",
					required: true,
					placeholder: "e.g., 500.00",
				},
				{
					name: "totalAmount",
					label: "Total Deposit",
					required: true,
					placeholder: "e.g., 2,000.00",
				},
			],
		},
		rules: { allowedOn: ["task"] },
		render(params?: {
			currency?: string;
			paidAmount?: string;
			totalAmount?: string;
		}) {
			const currency = (params?.currency ?? "USD").trim();
			const paidAmount = (params?.paidAmount ?? "").trim();
			const totalAmount = (params?.totalAmount ?? "").trim();

			const inner = chip({
				id: "crm-deposit",
				text: `<strong>Deposit Paid ${wrapVar(
					"currency",
					currency
				)}${wrapVar("paidAmount", paidAmount)} / ${wrapVar(
					"currency",
					currency
				)}${wrapVar("totalAmount", totalAmount)}</strong>`,
				bg: colors.crmDeposit,
			});
			return wrapTemplate("crm.depositPaid", inner, {
				orderTag: this.orderTag,
			});
		},
	},

	paidInFull: {
		orderTag: "crm-payment",
		id: "crm.paidInFull",
		label: "CRM - Paid in Full",
		hasParams: true,
		paramsSchema: {
			title: "Mark Paid in Full",
			titles: { create: "Set Paid in Full", edit: "Edit Paid in Full" },
			description:
				"Record the paid vs. total amount (usually the same when fully paid).",
			fields: [
				{
					name: "currency",
					label: "Currency",
					type: "dropdown",
					required: true,
					placeholder: "Select currency…",
					defaultValue: "USD",
					options: currencyDropdownOptions,
				},
				{
					name: "paidAmount",
					label: "Paid Amount",
					required: true,
					placeholder: "e.g., 4,999.00",
				},
				{
					name: "totalAmount",
					label: "Total Amount",
					required: true,
					placeholder: "e.g., 4,999.00",
				},
			],
		},
		rules: { allowedOn: ["task"] },
		render(params?: {
			currency?: string;
			paidAmount?: string;
			totalAmount?: string;
		}) {
			const currency = (params?.currency ?? "USD").trim();
			const paidAmount = (params?.paidAmount ?? "").trim();
			const totalAmount = (params?.totalAmount ?? "").trim();

			const inner = chip({
				id: "crm-paid-full",
				text: `<strong>Paid in Full ${wrapVar(
					"currency",
					currency
				)}${wrapVar("paidAmount", paidAmount)} / ${wrapVar(
					"currency",
					currency
				)}${wrapVar("totalAmount", totalAmount)}</strong>`,
				bg: colors.crmPaidFull,
			});
			return wrapTemplate("crm.paidInFull", inner, {
				orderTag: this.orderTag,
			});
		},
	},

	partiallyPaid: {
		orderTag: "crm-payment",
		id: "crm.partiallyPaid",
		label: "CRM - Partially Paid",
		hasParams: true,
		paramsSchema: {
			title: "Record Partial Payment",
			titles: {
				create: "Set Partial Payment",
				edit: "Edit Partial Payment",
			},
			description: "Record the amount paid vs. total amount.",
			fields: [
				{
					name: "currency",
					label: "Currency",
					type: "dropdown",
					required: true,
					placeholder: "Select currency…",
					defaultValue: "USD",
					options: currencyDropdownOptions,
				},
				{
					name: "paidAmount",
					label: "Paid Amount",
					required: true,
					placeholder: "e.g., 1,250.00",
				},
				{
					name: "totalAmount",
					label: "Total Amount",
					required: true,
					placeholder: "e.g., 5,000.00",
				},
			],
		},
		rules: { allowedOn: ["task"] },
		render(params?: {
			currency?: string;
			paidAmount?: string;
			totalAmount?: string;
		}) {
			const currency = (params?.currency ?? "USD").trim();
			const paidAmount = (params?.paidAmount ?? "").trim();
			const totalAmount = (params?.totalAmount ?? "").trim();

			const inner = chip({
				id: "crm-partially-paid",
				text: `<strong>Paid ${wrapVar("currency", currency)}${wrapVar(
					"paidAmount",
					paidAmount
				)} / ${wrapVar("currency", currency)}${wrapVar(
					"totalAmount",
					totalAmount
				)}</strong>`,
				bg: colors.crmPartially,
			});
			return wrapTemplate("crm.partiallyPaid", inner, {
				orderTag: this.orderTag,
			});
		},
	},

	paymentPlan: {
		orderTag: "crm-payment",
		id: "crm.paymentPlan",
		label: "CRM - Payment Plan",
		hasParams: true,
		paramsSchema: {
			title: "Set Payment Plan",
			titles: {
				create: "Create Payment Plan",
				edit: "Edit Payment Plan",
			},
			description:
				"Define terms for the payment plan and progress to date.",
			fields: [
				{
					name: "months",
					label: "Number of Months",
					required: true,
					placeholder: "e.g., 6",
				},
				{
					name: "endDate",
					label: "End Date",
					required: true,
					placeholder: "YYYY-MM-DD",
				},
				{
					name: "currency",
					label: "Currency",
					type: "dropdown",
					required: true,
					placeholder: "Select currency…",
					defaultValue: "USD",
					options: currencyDropdownOptions,
				},
				{
					name: "paidAmount",
					label: "Paid Amount",
					required: true,
					placeholder: "e.g., 1,500.00",
				},
				{
					name: "totalAmount",
					label: "Total Amount",
					required: true,
					placeholder: "e.g., 6,000.00",
				},
			],
		},
		rules: { allowedOn: ["task"] },
		render(params?: {
			months?: string;
			endDate?: string;
			currency?: string;
			paidAmount?: string;
			totalAmount?: string;
		}) {
			const months = (params?.months ?? "").trim();
			const endDate = (params?.endDate ?? "").trim();
			const currency = (params?.currency ?? "USD").trim();
			const paidAmount = (params?.paidAmount ?? "").trim();
			const totalAmount = (params?.totalAmount ?? "").trim();

			const inner = chip({
				id: "crm-payment-plan",
				text: `<strong>Payment Plan - ${wrapVar(
					"months",
					months
				)} Months → ${wrapVar("endDate", endDate)} - Paid ${wrapVar(
					"currency",
					currency
				)}${wrapVar("paidAmount", paidAmount)} / ${wrapVar(
					"currency",
					currency
				)}${wrapVar("totalAmount", totalAmount)}</strong>`,
				bg: colors.crmPaymentPlan,
			});
			return wrapTemplate("crm.paymentPlan", inner, {
				orderTag: this.orderTag,
			});
		},
	},
};
/**
 * Members — tasks only
 */
export const Members: Record<string, TemplateDefinition<any>> = {
	assignee: {
		orderTag: "assignment",
		id: "members.assignee",
		label: "Members - Assignee",
		hiddenFromDynamicCommands: true,
		hasParams: true,
		rules: { allowedOn: ["task"] },
		render(params: {
			memberName: string;
			memberSlug: string;
			assignmentState: "active" | "inactive";
			memberType:
				| "teamMember"
				| "delegateTeam"
				| "delegateTeamMember"
				| "delegateExternal"
				| "special";
		}) {
			const memberName = params.memberName.trim();
			const memberType = params.memberType.trim();
			const memberSlug = params.memberSlug.trim();
			const { assignmentState } = params;

			// Emoji per memberType (unchanged)
			let emoji = "";
			switch (memberType) {
				case "teamMember":
					emoji = emojis.teamMember;
					break;
				case "delegateTeam":
					emoji = emojis.delegateTeam;
					break;
				case "delegateTeamMember":
					emoji = emojis.delegateTeamMember;
					break;
				case "delegateExternal":
					emoji = emojis.delegateExternal;
					break;
				case "special":
					emoji = emojis.everyone;
					break;
				default:
			}

			// Assign type: assignee for team members and "special" (Everyone), delegate for the rest
			const assignType =
				memberType === "teamMember" || memberType === "special"
					? "assignee"
					: "delegate";

			// Background color depends on active/inactive
			const isInactive = assignmentState === "inactive";
			let bg = colors.obsidianTagGrey; // default for inactive
			if (!isInactive) {
				if (assignType === "assignee") {
					bg = colors.assignee;
				} else {
					bg = colors.delegate;
				}
			}

			const inner = chip({
				id: "assignee",
				text: `<strong>${emoji} ${memberName}</strong>`,
				bg,
				color: "#000000",
			});
			return wrapTemplate("members.assignee", inner, {
				orderTag: this.orderTag,
				assignmentState,
				memberSlug,
				memberType,
				assignType,
			});
		},
	},
};

/**
 * Prioritization — lists only
 */
export const Prioritization: Record<string, TemplateDefinition<any>> = {
	kanoDissatisfier: {
		orderTag: "priority",
		id: "prio.kano.dissatisfier",
		label: "Kano - Dissatisfier",
		rules: { allowedOn: ["list"] },
		render() {
			const inner = chip({
				id: "kano-dissatisfier",
				text: `<strong>${emojis.kanoLeft} Kano - Dissatisfier</strong>`,
				bg: colors.kanoDissatisfier,
			});
			return wrapTemplate("prio.kano.dissatisfier", inner, {
				orderTag: this.orderTag,
			});
		},
	},
	kanoIndifferent: {
		id: "prio.kano.indifferent",
		label: "Kano - Indifferent",
		rules: { allowedOn: ["list"] },
		render() {
			const inner = chip({
				id: "kano-indifferent",
				text: `<strong>${emojis.kanoIndiff} Kano - Indifferent</strong>`,
				bg: colors.kanoIndifferent,
			});
			return wrapTemplate("prio.kano.indifferent", inner, {
				orderTag: this.orderTag,
			});
		},
	},
	kanoBasic: {
		id: "prio.kano.basic",
		label: "Kano - Basic",
		rules: { allowedOn: ["list"] },
		render() {
			const inner = chip({
				id: "kano-basic",
				text: `<strong>${emojis.kanoBasic} Kano - Basic</strong>`,
				bg: colors.kanoBasic,
			});
			return wrapTemplate("prio.kano.basic", inner, {
				orderTag: this.orderTag,
			});
		},
	},
	kanoPerformantHeader: {
		id: "prio.kano.performantHeader",
		label: "Kano - Performant - Header",
		rules: { allowedOn: ["list"] },
		render() {
			const inner = chip({
				id: "kano-performant-header",
				text: `<strong>${emojis.kanoPerf} Kano - Performant</strong>`,
				bg: colors.kanoPerformant,
			});
			return wrapTemplate("prio.kano.performantHeader", inner, {
				orderTag: this.orderTag,
			});
		},
	},
	kanoDelighter: {
		id: "prio.kano.delighter",
		label: "Kano - Delighter",
		rules: { allowedOn: ["list"] },
		render() {
			const inner = chip({
				id: "kano-delighter",
				text: `<strong>${emojis.kanoDelight} Kano - Delighter</strong>`,
				bg: colors.kanoDelighter,
			});
			return wrapTemplate("prio.kano.delighter", inner, {
				orderTag: this.orderTag,
			});
		},
	},
	moscowCould: {
		id: "prio.moscow.could",
		label: "MoSCoW - Could Have",
		rules: { allowedOn: ["list"] },
		render() {
			const inner = chip({
				id: "moscow-could",
				text: `<strong>❓ Could Have</strong>`,
				bg: colors.moscowCould,
			});
			return wrapTemplate("prio.moscow.could", inner, {
				orderTag: this.orderTag,
			});
		},
	},
	moscowMust: {
		id: "prio.moscow.must",
		label: "MoSCoW - Must Have",
		rules: { allowedOn: ["list"] },
		render() {
			const inner = chip({
				id: "moscow-must",
				text: `<strong>❗Must-Have</strong>`,
				bg: colors.moscowMust,
			});
			return wrapTemplate("prio.moscow.must", inner, {
				orderTag: this.orderTag,
			});
		},
	},
	moscowShould: {
		id: "prio.moscow.should",
		label: "MoSCoW - Should Have",
		rules: { allowedOn: ["list"] },
		render() {
			const inner = chip({
				id: "moscow-should",
				text: `<strong>🎁 Should Have</strong>`,
				bg: colors.moscowShould,
			});
			return wrapTemplate("prio.moscow.should", inner, {
				orderTag: this.orderTag,
			});
		},
	},
	moscowWont: {
		id: "prio.moscow.wont",
		label: "MoSCoW - Won’t Have",
		rules: { allowedOn: ["list"] },
		render() {
			const inner = chip({
				id: "moscow-wont",
				text: `<strong>❌ Won’t Have</strong>`,
				bg: colors.moscowWont,
			});
			return wrapTemplate("prio.moscow.wont", inner, {
				orderTag: this.orderTag,
			});
		},
	},

	// NALAp (convert to chips so they are clickable and discoverable)
	nalapAdhoc: {
		id: "prio.nalap.adhoc",
		label: "NALAp - Adhoc",
		rules: { allowedOn: ["list"] },
		render() {
			const inner = chip({
				id: "nalap-adhoc",
				text: `📂 <strong>Adhoc</strong>`,
				bg: colors.kanoBasic,
			});
			return wrapTemplate("prio.nalap.adhoc", inner, {
				orderTag: this.orderTag,
			});
		},
	},
	nalapAlways: {
		id: "prio.nalap.always",
		label: "NALAp - Always",
		rules: { allowedOn: ["list"] },
		render() {
			const inner = chip({
				id: "nalap-always",
				text: `📍 <strong>Always</strong>`,
				bg: colors.kanoPerformant,
			});
			return wrapTemplate("prio.nalap.always", inner, {
				orderTag: this.orderTag,
			});
		},
	},
	nalapDone: {
		id: "prio.nalap.done",
		label: "NALAp - Done",
		rules: { allowedOn: ["list"] },
		render() {
			const inner = chip({
				id: "nalap-done",
				text: `✅ <strong>Done</strong>`,
				bg: colors.crmPaidFull,
			});
			return wrapTemplate("prio.nalap.done", inner, {
				orderTag: this.orderTag,
			});
		},
	},
	nalapDropped: {
		id: "prio.nalap.dropped",
		label: "NALAp - Dropped",
		rules: { allowedOn: ["list"] },
		render() {
			const inner = chip({
				id: "nalap-dropped",
				text: `❌ <strong>Dropped</strong>`,
				bg: colors.moscowWont,
			});
			return wrapTemplate("prio.nalap.dropped", inner, {
				orderTag: this.orderTag,
			});
		},
	},
	nalapLater: {
		id: "prio.nalap.later",
		label: "NALAp - Later",
		rules: { allowedOn: ["list"] },
		render() {
			const inner = chip({
				id: "nalap-later",
				text: `🛠️ <strong>Later</strong>`,
				bg: colors.moscowShould,
			});
			return wrapTemplate("prio.nalap.later", inner, {
				orderTag: this.orderTag,
			});
		},
	},
	nalapNow: {
		id: "prio.nalap.now",
		label: "NALAp - Now",
		rules: { allowedOn: ["list"] },
		render() {
			const inner = chip({
				id: "nalap-now",
				text: `🚀 <strong>Now</strong>`,
				bg: colors.moscowMust,
			});
			return wrapTemplate("prio.nalap.now", inner, {
				orderTag: this.orderTag,
			});
		},
	},
};

/**
 * Workflows — tasks only
 */
export const Workflows: Record<string, TemplateDefinition<any>> = {
	// Metadata
	pr: {
		orderTag: "metadata",
		id: "workflows.metadata.pr",
		label: "Workflow - PR",
		rules: { allowedOn: ["task"] },
		render(params?: { href?: string }) {
			const href = (params?.href ?? "").trim();
			const anchorOpen = href ? `<a href="${href}">` : `<a href="">`;
			const inner = chip({
				id: "wf-pr",
				text: `<strong>${anchorOpen}${emojis.pr} </a></strong>`,
				bg: colors.black,
				color: colors.textGrey,
			});
			return wrapTemplate("workflows.metadata.pr", inner, {
				orderTag: this.orderTag,
			});
		},
	},
	branch: {
		orderTag: "metadata",
		id: "workflows.metadata.branch",
		label: "Workflow - Branch",
		rules: { allowedOn: ["task"] },
		render(params?: { href?: string }) {
			const href = (params?.href ?? "").trim();
			const anchorOpen = href ? `<a href="${href}">` : `<a href="">`;
			const inner = chip({
				id: "wf-branch",
				text: `<strong>${anchorOpen}${emojis.branch} </a></strong>`,
				bg: colors.black,
				color: colors.textGrey,
			});
			return wrapTemplate("workflows.metadata.branch", inner, {
				orderTag: this.orderTag,
			});
		},
	},
	linkToArtifact: {
		orderTag: "metadata",
		id: "workflows.metadata.linkToArtifact",
		label: "Workflow - Link to Artifact",
		hasParams: true,
		paramsSchema: {
			title: "Link Artifact",
			titles: {
				create: "Link Artifact",
				edit: "Edit Linked Artifact",
			},
			fields: [
				{
					name: "blockRef",
					label: "Linked Artifact",
					required: true,
					type: "blockSelect",
					placeholder: "Start typing...",
				},
				{
					name: "artifactType",
					label: "Artifact Type",
					type: "dropdown",
					required: true,
					placeholder: "Select artifact type…",
					defaultValue: null,
					options: artifactOptions,
				},
			],
		},
		rules: { allowedOn: ["task"] },
		render(params: { blockRef: string; artifactType: string }) {
			const blockRef = params.blockRef.trim();
			const selected = artifactOptions.find(
				(o) => o.value === params.artifactType
			);
			// Given required field + controlled options, selected should always exist.
			// If not, fail loudly to surface configuration mismatch.
			if (!selected) {
				throw new Error(
					`Unknown artifactType value: ${params.artifactType}`
				);
			}

			const emoji = selected.value;
			const linkedArtifactType = selected.text;

			const inner = chip({
				id: "wf-link-to-artifact",
				text: `<strong><a class="internal-link" ${attrVar(
					"href",
					"blockRef",
					blockRef
				)}>🔗${emoji}</a></strong>`,
				bg: colors.black,
				color: colors.textGrey,
			});

			return wrapTemplate("workflows.metadata.linkToArtifact", inner, {
				orderTag: this.orderTag,
				linkedArtifactType,
			});
		},
	},
	version: {
		orderTag: "metadata",
		id: "workflows.metadata.version",
		label: "Workflow - Version",
		hasParams: true,
		paramsSchema: {
			titles: { create: "Set Version", edit: "Edit Version" },
			description:
				"Add a semantic version and (optionally) a link to release notes.",
			fields: [
				{
					name: "version",
					label: "Version",
					required: true,
					placeholder: "e.g., 0.5.0",
				},
			],
		},
		rules: { allowedOn: ["task", "list"] },
		render(params?: { version?: string }) {
			const version = (params?.version ?? "").trim();

			const inner = chip({
				id: "wf-version",
				text: `<strong>${emojis.version} ${wrapVar(
					"version",
					version
				)}</strong>`,
				bg: `linear-gradient(to right, ${colors.versionFrom}, ${colors.versionTo})`,
				// No explicit text color to keep it similar to your example
			});

			return wrapTemplate("workflows.metadata.version", inner, {
				orderTag: this.orderTag,
			});
		},
	},

	// States
	blocked: {
		orderTag: "state",
		id: "workflows.states.blocked",
		label: "Workflow - State: Blocked",
		hasParams: true,
		paramsSchema: {
			titles: { create: "Set State", edit: "Edit State" },
			fields: [
				{
					name: "href",
					label: "Requires",
					required: true,
					type: "blockSelect",
					placeholder: "Select a blocking task…",
				},
				{
					name: "details",
					label: "Details",
					required: true,
					type: "textarea",
					placeholder:
						"Enter title for blocking task (for display only)...",
				},
			],
		},
		rules: { allowedOn: ["task"] },
		render(params?: { details?: string; href?: string }) {
			const details = (params?.details ?? "").trim();
			const href = (params?.href ?? "").trim();
			const anchorOpen = `<a class="internal-link" ${attrVar(
				"href",
				"href",
				href
			)}>`;
			const inner = chip({
				id: "state-blocked",
				text: `⛔ <strong>Requires: ${anchorOpen}${wrapVar(
					"details",
					details
				)}</a></strong>`,
				bg: colors.statesBlocked,
			});
			return wrapTemplate("workflows.states.blocked", inner, {
				orderTag: this.orderTag,
			});
		},
	},
	pending: {
		orderTag: "state",
		id: "workflows.states.pending",
		label: "Workflow - State: Pending",
		rules: { allowedOn: ["task"] },
		render(params?: { resumes?: string }) {
			const resumes = (params?.resumes ?? "").trim();
			const inner = chip({
				id: "state-pending",
				text: `🕒 Resumes: <strong>${resumes}</strong>`,
				bg: colors.statesPending,
			});
			return wrapTemplate("workflows.states.pending", inner, {
				orderTag: this.orderTag,
			});
		},
	},
	waiting: {
		orderTag: "state",
		id: "workflows.states.waiting",
		label: "Workflow - State: Waiting",
		hasParams: true,
		paramsSchema: {
			titles: { create: "Set State", edit: "Edit State" },
			fields: [
				{
					name: "for",
					label: "For",
					required: true,
					placeholder: "Describe what the task is waiting for...",
				},
			],
		},
		rules: { allowedOn: ["task"] },
		render(params?: { for?: string }) {
			const forWhat = (params?.for ?? "").trim();
			const inner = chip({
				id: "state-waiting",
				text: `⌛ <strong>For: ${wrapVar("for", forWhat)}</strong>`,
				bg: colors.statesWaiting,
			});
			return wrapTemplate("workflows.states.waiting", inner, {
				orderTag: this.orderTag,
			});
		},
	},
	review: {
		orderTag: "state",
		id: "workflows.states.review",
		label: "Workflow - State: Awaiting Review",
		hasParams: true,
		paramsSchema: {
			title: "Awaiting Review",
			fields: [
				{
					name: "teamMember",
					label: "Reviewer",
					required: true,
					placeholder: "e.g., Alice",
				},
			],
		},
		rules: { allowedOn: ["task"] },
		render(params: { teamMember: string }) {
			const teamMember = params?.teamMember?.trim() ?? "";
			const inner = chip({
				id: "agile-review",
				text: `Awaiting Review from ${wrapVar(
					"teamMember",
					teamMember
				)}`,
				bg: `linear-gradient(to right, ${colors.reviewFrom}, ${colors.reviewTo})`,
				color: colors.reviewText,
			});
			return wrapTemplate("workflows.states.review", inner, {
				orderTag: this.orderTag,
			});
		},
	},
};

/**
 * Obsidian Extensions — can be inserted on tasks, lists, or outside both
 */
export const ObsidianExtensions: Record<string, TemplateDefinition<any>> = {
	internalInlineLink: {
		orderTag: "internal-link",
		id: "obsidian.internalInlineLink",
		label: "Obsidian - Internal Inline Link",
		hasParams: true,
		paramsSchema: {
			title: "Internal Link",
			fields: [
				{
					name: "href",
					label: "Target (note path or block link)",
					required: true,
					placeholder: "e.g., Projects/2025-Roadmap or #^block-id",
				},
				{
					name: "linkContent",
					label: "Link Text",
					required: true,
					placeholder: "e.g., Open Roadmap",
				},
			],
		},
		rules: { allowedOn: ["any"] },
		render(params: { href: string; linkContent: string }) {
			const href = params?.href?.trim() ?? "";
			const linkContent = params?.linkContent?.trim() ?? "";
			const inner = chip({
				id: "obsidian-internal-link",
				text: `<a class="internal-link" ${attrVar(
					"href",
					"href",
					href
				)}>${wrapVar("linkContent", linkContent)}</a>`,
				bg: colors.obsidianTagGrey,
			});
			return wrapTemplate("obsidian.internalInlineLink", inner, {
				orderTag: this.orderTag,
			});
		},
	},
	timestamp: {
		orderTag: "timestamp",
		id: "obsidian.timestamp",
		label: "Obsidian - Timestamp",
		rules: { allowedOn: ["any"] },
		render() {
			const inner = chip({
				id: "obsidian-timestamp",
				text: `<strong>${emojis.timestamp} {{date:YYYY-MM-DD HH:MM:SS}}</strong>`,
				bg: colors.obsidianTagGrey,
			});
			return wrapTemplate("obsidian.timestamp", inner, {
				orderTag: this.orderTag,
			});
		},
	},
	datestamp: {
		orderTag: "datestamp",
		id: "obsidian.datestamp",
		label: "Obsidian - Datestamp",
		rules: { allowedOn: ["any"] },
		render() {
			const inner = chip({
				id: "obsidian-datestamp",
				text: `<strong>${emojis.datestamp} {{date:YYYY-MM-DD}}</strong>`,
				bg: colors.obsidianTagGrey,
			});
			return wrapTemplate("obsidian.datestamp", inner, {
				orderTag: this.orderTag,
			});
		},
	},
};

// Group export that templateApi.findTemplateById expects
export const presetTemplates = {
	agile: Agile,
	crm: CRM,
	members: Members,
	prioritization: Prioritization,
	workflows: Workflows,
	obsidian: ObsidianExtensions,
};
