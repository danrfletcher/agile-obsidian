import tokensData from "./tokens.json";
import { markChip } from "./htmlPartials";
import type { TemplateDefinition } from "./types";

// Derive from JSON
const colors = tokensData.colors as Record<string, string>;
const emojis = tokensData.emojis as Record<string, string>;

// Utility to build a mark chip without any numeric order (order is dropped)
function chip(opts: {
	id: string;
	text: string;
	orderTag: string;
	bg?: string;
	color?: string;
	bold?: boolean;
	href?: string;
	kind?: string;
	extraAttrs?: Record<string, string | number | boolean | undefined>;
}): string {
	const { id, text, orderTag, bg, color, bold, href, kind, extraAttrs } =
		opts;
	return markChip({
		id,
		text,
		orderTag,
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
		id: "agile.initiative",
		label: "Agile - Initiative",
		hasParams: true,
		paramsSchema: {
			title: "Create Initiative",
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
			const text = `<strong>${emojis.initiative} ${title}</strong>${
				details && `:`
			}`;
			return `${chip({
				id: "agile-initiative",
				text,
				orderTag: "artifact-item-type",
				bg: colors.artifactGrey,
			})}${details ? ` ${details}` : ""}`;
		},
	},

	epic: {
		id: "agile.epic",
		label: "Agile - Epic",
		hasParams: true,
		paramsSchema: {
			title: "Create Epic",
			description:
				"Provide a title and optional details for the epic.",
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
			return `${chip({
				id: "agile-epic",
				text: `<strong>${emojis.epic} ${title}${
					details ? ":" : ""
				}</strong>`,
				orderTag: "artifact-item-type",
				bg: colors.artifactGrey,
			})}${details && ` ${details}`}`;
		},
	},

	feature: {
		id: "agile.feature",
		label: "Agile - Feature",
		hasParams: true,
		paramsSchema: {
			title: "Create Feature",
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
			const text = `<strong>${emojis.feature} ${title}</strong>${
				details ? `:` : ""
			}`;
			return `${chip({
				id: "agile-feature",
				text,
				orderTag: "artifact-item-type",
				bg: colors.artifactGrey,
			})}${details ? ` ${details}` : ""}`;
		},
	},

	product: {
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
			return chip({
				id: "agile-product",
				text: `${main}${tail}`,
				orderTag: "artifact-item-type",
				bg: colors.artifactGrey,
			});
		},
	},

	userStory: {
		id: "agile.userStory",
		label: "Agile - User Story",
		hasParams: true,
		paramsSchema: {
			title: "Create User Story",
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

			const clause =
				persona && desire && outcome
					? ` **As a** ${persona} , **I want to** ${desire} , **so that** ${outcome}`
					: "";

			const text = `<strong>${emojis.story} ${title}${
				clause ? ":" : ""
			}</strong>`;

			return `${chip({
				id: "agile-user-story",
				text,
				orderTag: "artifact-item-type",
				bg: `linear-gradient(to right, ${colors.userStoryFrom}, ${colors.userStoryTo})`,
			})}${clause && ` ${clause}`}`;
		},
	},

	acceptanceCriteria: {
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
			const text = `<strong>${emojis.accept} ${title}</strong>${
				details ? `:` : ""
			}`;
			return `${chip({
				id: "agile-acceptance",
				text,
				orderTag: "artifact-item-type",
				bg: colors.artifactGrey,
			})}${details ? ` ${details}` : ""}`;
		},
	},

	kpi: {
		id: "agile.kpi",
		label: "Agile - KPI",
		hasParams: true,
		paramsSchema: {
			title: "Add KPI",
			fields: [
				{
					name: "title",
					label: "Title",
					required: true,
					placeholder: "e.g., Weekly Active Users",
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
			const text = `<strong>${emojis.kpi} ${title}</strong>${
				details ? `:` : ""
			}`;
			return `${chip({
				id: "agile-kpi",
				text,
				orderTag: "artifact-item-type",
				bg: colors.artifactGrey,
			})}${details ? ` ${details}` : ""}`;
		},
	},

	okr: {
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
			const text = `<strong>${emojis.okr} ${title}</strong>${
				details ? `:` : ""
			}`;
			return `${chip({
				id: "agile-okr",
				text,
				orderTag: "artifact-item-type",
				bg: `linear-gradient(to left, ${colors.okrFrom}, ${colors.okrTo})`,
			})}${details ? ` ${details}` : ""}`;
		},
	},

	artifactParentLink: {
		id: "agile.parentLink",
		label: "Agile - Artifact Parent Link",
		rules: { allowedOn: ["task"] },
		render() {
			return chip({
				id: "agile-artifact-parent-link",
				text: `${emojis.linkArrowUp}`,
				orderTag: "parent-link",
				href: "",
			});
		},
	},

	personalLearningInitiative: {
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
			return chip({
				id: "agile-personal-learning-initiative",
				text: `${main}${tail}`,
				orderTag: "artifact-item-type",
				bg: `linear-gradient(to right, ${colors.personalInitFrom}, ${colors.personalInitTo})`,
				color: "#FFFFFF",
			});
		},
	},

	personalLearningEpic: {
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
			return chip({
				id: "agile-personal-learning-epic",
				text: `${main}${tail}`,
				orderTag: "artifact-item-type",
				bg: `linear-gradient(to right, ${colors.personalEpicFrom}, ${colors.personalEpicTo})`,
				color: "#FFFFFF",
			});
		},
	},
};

/**
 * CRM — lists only
 */
export const CRM: Record<string, TemplateDefinition<any>> = {
	abandoned: {
		id: "crm.abandoned",
		label: "CRM - Abandoned",
		rules: { allowedOn: ["list"] },
		render() {
			return chip({
				id: "crm-abandoned",
				text: `<strong>Abandoned</strong>`,
				orderTag: "metadata-tag",
				bg: colors.crmAbandoned,
			});
		},
	},
	awaitingDeposit: {
		id: "crm.awaitingDeposit",
		label: "CRM - Awaiting Deposit",
		rules: { allowedOn: ["list"] },
		render() {
			return chip({
				id: "crm-awaiting-deposit",
				text: `<strong>Awaiting Deposit</strong>`,
				orderTag: "metadata-tag",
				bg: colors.crmAwaiting,
			});
		},
	},
	commission: {
		id: "crm.commission",
		label: "CRM - Commission",
		rules: { allowedOn: ["list"] },
		render() {
			return chip({
				id: "crm-commission",
				text: `<strong>Commission Paid /</strong>`,
				orderTag: "metadata-tag",
				bg: colors.crmCommission,
			});
		},
	},
	depositPaid: {
		id: "crm.depositPaid",
		label: "CRM - Deposit Paid",
		rules: { allowedOn: ["list"] },
		render() {
			return chip({
				id: "crm-deposit",
				text: `<strong>Deposit Paid /</strong>`,
				orderTag: "metadata-tag",
				bg: colors.crmDeposit,
			});
		},
	},
	paidInFull: {
		id: "crm.paidInFull",
		label: "CRM - Paid in Full",
		rules: { allowedOn: ["list"] },
		render() {
			return chip({
				id: "crm-paid-full",
				text: `<strong>Paid in Full / </strong>`,
				orderTag: "metadata-tag",
				bg: colors.crmPaidFull,
			});
		},
	},
	partiallyPaid: {
		id: "crm.partiallyPaid",
		label: "CRM - Partially Paid",
		rules: { allowedOn: ["list"] },
		render() {
			return chip({
				id: "crm-partially-paid",
				text: `<strong>Paid  / </strong>`,
				orderTag: "metadata-tag",
				bg: colors.crmPartially,
			});
		},
	},
	paymentPlan: {
		id: "crm.paymentPlan",
		label: "CRM - Payment Plan",
		rules: { allowedOn: ["list"] },
		render() {
			return chip({
				id: "crm-payment-plan",
				text: `<strong>Payment Plan - [Number] Months - [End Date YYYY-MM-DD] - Paid  / </strong>`,
				orderTag: "metadata-tag",
				bg: colors.crmPaymentPlan,
			});
		},
	},
};

/**
 * Members — tasks only
 */
export const Members: Record<string, TemplateDefinition<any>> = {
	assignee: {
		id: "members.assignee",
		label: "Members - Assignee",
		rules: { allowedOn: ["task"] },
		render(params?: { label?: string; everyoneIcon?: string }) {
			const label = params?.label?.trim() ?? "Everyone";
			const everyoneIcon = params?.everyoneIcon ?? emojis.everyone;
			return chip({
				id: "assignee",
				text: `<strong>${everyoneIcon} ${label}</strong>`,
				orderTag: "assignee",
				bg: "#FFFFFF",
				color: "#000000",
				extraAttrs: { class: "active-team internal-link" },
			});
		},
	},
};

/**
 * Prioritization — lists only
 */
export const Prioritization: Record<string, TemplateDefinition<any>> = {
	kanoDissatisfier: {
		id: "prio.kano.dissatisfier",
		label: "Kano - Dissatisfier",
		rules: { allowedOn: ["list"] },
		render() {
			return chip({
				id: "kano-dissatisfier",
				text: `<strong>${emojis.kanoLeft} Kano - Dissatisfier</strong>`,
				orderTag: "artifact-item-type",
				bg: colors.kanoDissatisfier,
			});
		},
	},
	kanoIndifferent: {
		id: "prio.kano.indifferent",
		label: "Kano - Indifferent",
		rules: { allowedOn: ["list"] },
		render() {
			return chip({
				id: "kano-indifferent",
				text: `<strong>${emojis.kanoIndiff} Kano - Indifferent</strong>`,
				orderTag: "artifact-item-type",
				bg: colors.kanoIndifferent,
			});
		},
	},
	kanoBasic: {
		id: "prio.kano.basic",
		label: "Kano - Basic",
		rules: { allowedOn: ["list"] },
		render() {
			return chip({
				id: "kano-basic",
				text: `<strong>${emojis.kanoBasic} Kano - Basic</strong>`,
				orderTag: "artifact-item-type",
				bg: colors.kanoBasic,
			});
		},
	},
	kanoPerformantHeader: {
		id: "prio.kano.performantHeader",
		label: "Kano - Performant - Header",
		rules: { allowedOn: ["list"] },
		render() {
			return chip({
				id: "kano-performant-header",
				text: `<strong>${emojis.kanoPerf} Kano - Performant</strong>`,
				orderTag: "artifact-item-type",
				bg: colors.kanoPerformant,
			});
		},
	},
	kanoDelighter: {
		id: "prio.kano.delighter",
		label: "Kano - Delighter",
		rules: { allowedOn: ["list"] },
		render() {
			return chip({
				id: "kano-delighter",
				text: `<strong>${emojis.kanoDelight} Kano - Delighter</strong>`,
				orderTag: "artifact-item-type",
				bg: colors.kanoDelighter,
			});
		},
	},
	moscowCould: {
		id: "prio.moscow.could",
		label: "MoSCoW - Could Have",
		rules: { allowedOn: ["list"] },
		render() {
			return chip({
				id: "moscow-could",
				text: `<strong>❓ Could Have</strong>`,
				orderTag: "artifact-item-type",
				bg: colors.moscowCould,
			});
		},
	},
	moscowMust: {
		id: "prio.moscow.must",
		label: "MoSCoW - Must Have",
		rules: { allowedOn: ["list"] },
		render() {
			return chip({
				id: "moscow-must",
				text: `<strong>❗Must-Have</strong>`,
				orderTag: "artifact-item-type",
				bg: colors.moscowMust,
			});
		},
	},
	moscowShould: {
		id: "prio.moscow.should",
		label: "MoSCoW - Should Have",
		rules: { allowedOn: ["list"] },
		render() {
			return chip({
				id: "moscow-should",
				text: `<strong>🎁 Should Have</strong>`,
				orderTag: "artifact-item-type",
				bg: colors.moscowShould,
			});
		},
	},
	moscowWont: {
		id: "prio.moscow.wont",
		label: "MoSCoW - Won’t Have",
		rules: { allowedOn: ["list"] },
		render() {
			return chip({
				id: "moscow-wont",
				text: `<strong>❌ Won’t Have</strong>`,
				orderTag: "artifact-item-type",
				bg: colors.moscowWont,
			});
		},
	},

	// NALAp
	nalapAdhoc: {
		id: "prio.nalap.adhoc",
		label: "NALAp - Adhoc",
		rules: { allowedOn: ["list"] },
		render() {
			return `📂 **Adhoc**`;
		},
	},
	nalapAlways: {
		id: "prio.nalap.always",
		label: "NALAp - Always",
		rules: { allowedOn: ["list"] },
		render() {
			return `📍 **Always**`;
		},
	},
	nalapDone: {
		id: "prio.nalap.done",
		label: "NALAp - Done",
		rules: { allowedOn: ["list"] },
		render() {
			return `✅ **Done**`;
		},
	},
	nalapDropped: {
		id: "prio.nalap.dropped",
		label: "NALAp - Dropped",
		rules: { allowedOn: ["list"] },
		render() {
			return `❌ **Dropped**`;
		},
	},
	nalapLater: {
		id: "prio.nalap.later",
		label: "NALAp - Later",
		rules: { allowedOn: ["list"] },
		render() {
			return `🛠️ **Later**`;
		},
	},
	nalapNow: {
		id: "prio.nalap.now",
		label: "NALAp - Now",
		rules: { allowedOn: ["list"] },
		render() {
			return `🚀 **Now**`;
		},
	},
};

/**
 * Workflows — tasks only
 */
export const Workflows: Record<string, TemplateDefinition<any>> = {
	// Metadata
	pr: {
		id: "workflows.metadata.pr",
		label: "Workflow - PR",
		rules: { allowedOn: ["task"] },
		render(params?: { href?: string }) {
			const href = (params?.href ?? "").trim();
			const anchorOpen = href ? `<a href="${href}">` : `<a href="">`;
			return chip({
				id: "wf-pr",
				text: `<strong>${anchorOpen}${emojis.pr} </a></strong>`,
				orderTag: "metadata-tag",
				bg: colors.black,
				color: colors.textGrey,
			});
		},
	},
	branch: {
		id: "workflows.metadata.branch",
		label: "Workflow - Branch",
		rules: { allowedOn: ["task"] },
		render(params?: { href?: string }) {
			const href = (params?.href ?? "").trim();
			const anchorOpen = href ? `<a href="${href}">` : `<a href="">`;
			return chip({
				id: "wf-branch",
				text: `<strong>${anchorOpen}${emojis.branch} </a></strong>`,
				orderTag: "metadata-tag",
				bg: colors.black,
				color: colors.textGrey,
			});
		},
	},
	linkToArtifact: {
		id: "workflows.metadata.linkToArtifact",
		label: "Workflow - Link to Artifact",
		rules: { allowedOn: ["task"] },
		render(params?: { href?: string; text?: string }) {
			const href = (
				params?.href ?? "Artifact-block-link-with-no-square-brackets"
			).trim();
			const text = (params?.text ?? "🔗").trim();
			return chip({
				id: "wf-link-to-artifact",
				text: `<strong><a class="internal-link" href="${href}">${text}</a></strong>`,
				orderTag: "metadata-tag",
				bg: colors.black,
				color: colors.textGrey,
			});
		},
	},

	// States
	blocked: {
		id: "workflows.states.blocked",
		label: "Workflow - State: Blocked",
		rules: { allowedOn: ["task"] },
		render(params?: { requires?: string; href?: string }) {
			const requires = (params?.requires ?? "").trim();
			const href = (params?.href ?? "").trim();
			const anchorOpen = `<a class="internal-link" href="${href}">`;
			return chip({
				id: "state-blocked",
				text: `⛔ Requires: ${anchorOpen}<strong>${requires}</strong></a>`,
				orderTag: "metadata-tag",
				bg: colors.statesBlocked,
			});
		},
	},
	pending: {
		id: "workflows.states.pending",
		label: "Workflow - State: Pending",
		rules: { allowedOn: ["task"] },
		render(params?: { resumes?: string }) {
			const resumes = (params?.resumes ?? "").trim();
			return chip({
				id: "state-pending",
				text: `🕒 Resumes: <strong>${resumes}</strong>`,
				orderTag: "metadata-tag",
				bg: colors.statesPending,
			});
		},
	},
	waiting: {
		id: "workflows.states.waiting",
		label: "Workflow - State: Waiting",
		rules: { allowedOn: ["task"] },
		render(params?: { for?: string }) {
			const forWho = (params?.for ?? "").trim();
			return chip({
				id: "state-waiting",
				text: `⌛ For: <strong>${forWho}</strong>`,
				orderTag: "metadata-tag",
				bg: colors.statesWaiting,
			});
		},
	},
	review: {
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
			return chip({
				id: "agile-review",
				text: `Awaiting Review from ${teamMember}`,
				orderTag: "metadata-tag",
				bg: `linear-gradient(to right, ${colors.reviewFrom}, ${colors.reviewTo})`,
				color: colors.reviewText,
			});
		},
	},
};

/**
 * Obsidian Extensions — can be inserted on tasks, lists, or outside both
 */
export const ObsidianExtensions: Record<string, TemplateDefinition<any>> = {
	internalInlineLink: {
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
			return chip({
				id: "obsidian-internal-link",
				text: `<a href="${href}" class="internal-link">${linkContent}</a>`,
				orderTag: "metadata-tag",
				bg: colors.obsidianTagGrey,
			});
		},
	},
	timestamp: {
		id: "obsidian.timestamp",
		label: "Obsidian - Timestamp",
		rules: { allowedOn: ["any"] },
		render() {
			return chip({
				id: "obsidian-timestamp",
				text: `<strong>${emojis.timestamp} {{date:YYYY-MM-DD HH:MM:SS}}</strong>`,
				orderTag: "metadata-tag",
				bg: colors.obsidianTagGrey,
			});
		},
	},
	datestamp: {
		id: "obsidian.datestamp",
		label: "Obsidian - Datestamp",
		rules: { allowedOn: ["any"] },
		render() {
			return chip({
				id: "obsidian-datestamp",
				text: `<strong>${emojis.datestamp} {{date:YYYY-MM-DD}}</strong>`,
				orderTag: "metadata-tag",
				bg: colors.obsidianTagGrey,
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
