import tokensData from "./tokens.json";
import { markChip, wrapTemplate } from "./htmlPartials";
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
				details ? `:` : ""
			}`;

			const inner = `${chip({
				id: "agile-initiative",
				text,
				orderTag: "artifact-item-type",
				bg: colors.artifactGrey,
			})}${details ? ` ${details}` : ""}`;

			return wrapTemplate("agile.initiative", "agile-initiative", inner);
		},
	},

	epic: {
		id: "agile.epic",
		label: "Agile - Epic",
		hasParams: true,
		paramsSchema: {
			title: "Create Epic",
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
			const inner = `${chip({
				id: "agile-epic",
				text: `<strong>${emojis.epic} ${title}${
					details ? ":" : ""
				}</strong>`,
				orderTag: "artifact-item-type",
				bg: colors.artifactGrey,
			})}${details ? ` ${details}` : ""}`;
			return wrapTemplate("agile.epic", "agile-epic", inner);
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
			const inner = `${chip({
				id: "agile-feature",
				text,
				orderTag: "artifact-item-type",
				bg: colors.artifactGrey,
			})}${details ? ` ${details}` : ""}`;
			return wrapTemplate("agile.feature", "agile-feature", inner);
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
			const inner = chip({
				id: "agile-product",
				text: `${main}${tail}`,
				orderTag: "artifact-item-type",
				bg: colors.artifactGrey,
			});
			return wrapTemplate("agile.product", "agile-product", inner);
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

		parseParamsFromDom(wrapperEl) {
			const mark = wrapperEl.querySelector(
				"mark[data-template-id='agile-user-story']"
			);
			const data: Record<string, string> = {
				title: "",
				persona: "",
				desire: "",
				outcome: "",
			};

			if (mark) {
				const strong = mark.querySelector("strong");
				if (strong) {
					const raw = strong.textContent ?? "";
					const withoutEmoji = raw.replace("📝", "").trim();
					data.title = withoutEmoji.replace(/:$/, "").trim();
				}
			}

			const textNodes: string[] = [];
			for (const node of Array.from(wrapperEl.childNodes)) {
				if ((node as HTMLElement).tagName?.toLowerCase() === "mark")
					continue;
				textNodes.push((node.textContent ?? "").trim());
			}
			const tail = textNodes.join(" ").trim();
			const cleaned = tail.replace(/\*\*/g, "").trim();
			const personaMatch = cleaned.match(/As a\s+([^,]+)\s*,/i);
			const desireMatch = cleaned.match(/I want to\s+([^,]+)\s*,/i);
			const outcomeMatch = cleaned.match(/so that\s+(.+)$/i);

			if (personaMatch) data.persona = personaMatch[1].trim();
			if (desireMatch) data.desire = desireMatch[1].trim();
			if (outcomeMatch) data.outcome = outcomeMatch[1].trim();

			return data;
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

			const clause =
				persona && desire && outcome
					? ` **As a** ${persona} , **I want to** ${desire} , **so that** ${outcome}`
					: "";

			const text = `<strong>${emojis.story} ${title}${
				clause ? ":" : ""
			}</strong>`;

			const inner = `${chip({
				id: "agile-user-story",
				text,
				orderTag: "artifact-item-type",
				bg: `linear-gradient(to right, ${colors.userStoryFrom}, ${colors.userStoryTo})`,
			})}${clause ? ` ${clause}` : ""}`;

			return wrapTemplate("agile.userStory", "agile-user-story", inner);
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
			const inner = `${chip({
				id: "agile-acceptance",
				text,
				orderTag: "artifact-item-type",
				bg: colors.artifactGrey,
			})}${details ? ` ${details}` : ""}`;
			return wrapTemplate(
				"agile.acceptanceCriteria",
				"agile-acceptance",
				inner
			);
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
			const inner = `${chip({
				id: "agile-kpi",
				text,
				orderTag: "artifact-item-type",
				bg: colors.artifactGrey,
			})}${details ? ` ${details}` : ""}`;
			return wrapTemplate("agile.kpi", "agile-kpi", inner);
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
			const inner = `${chip({
				id: "agile-okr",
				text,
				orderTag: "artifact-item-type",
				bg: `linear-gradient(to left, ${colors.okrFrom}, ${colors.okrTo})`,
			})}${details ? ` ${details}` : ""}`;
			return wrapTemplate("agile.okr", "agile-okr", inner);
		},
	},

	artifactParentLink: {
		id: "agile.parentLink",
		label: "Agile - Artifact Parent Link",
		rules: { allowedOn: ["task"] },
		render() {
			const inner = chip({
				id: "agile-artifact-parent-link",
				text: `${emojis.linkArrowUp}`,
				orderTag: "parent-link",
				href: "",
			});
			return wrapTemplate(
				"agile.parentLink",
				"agile-artifact-parent-link",
				inner
			);
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
			const inner = chip({
				id: "agile-personal-learning-initiative",
				text: `${main}${tail}`,
				orderTag: "artifact-item-type",
				bg: `linear-gradient(to right, ${colors.personalInitFrom}, ${colors.personalInitTo})`,
				color: "#FFFFFF",
			});
			return wrapTemplate(
				"agile.personalLearningInitiative",
				"agile-personal-learning-initiative",
				inner
			);
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
			const inner = chip({
				id: "agile-personal-learning-epic",
				text: `${main}${tail}`,
				orderTag: "artifact-item-type",
				bg: `linear-gradient(to right, ${colors.personalEpicFrom}, ${colors.personalEpicTo})`,
				color: "#FFFFFF",
			});
			return wrapTemplate(
				"agile.personalLearningEpic",
				"agile-personal-learning-epic",
				inner
			);
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
			const inner = chip({
				id: "crm-abandoned",
				text: `<strong>Abandoned</strong>`,
				orderTag: "metadata-tag",
				bg: colors.crmAbandoned,
			});
			return wrapTemplate("crm.abandoned", "crm-abandoned", inner);
		},
	},
	awaitingDeposit: {
		id: "crm.awaitingDeposit",
		label: "CRM - Awaiting Deposit",
		rules: { allowedOn: ["list"] },
		render() {
			const inner = chip({
				id: "crm-awaiting-deposit",
				text: `<strong>Awaiting Deposit</strong>`,
				orderTag: "metadata-tag",
				bg: colors.crmAwaiting,
			});
			return wrapTemplate(
				"crm.awaitingDeposit",
				"crm-awaiting-deposit",
				inner
			);
		},
	},
	commission: {
		id: "crm.commission",
		label: "CRM - Commission",
		rules: { allowedOn: ["list"] },
		render() {
			const inner = chip({
				id: "crm-commission",
				text: `<strong>Commission Paid /</strong>`,
				orderTag: "metadata-tag",
				bg: colors.crmCommission,
			});
			return wrapTemplate("crm.commission", "crm-commission", inner);
		},
	},
	depositPaid: {
		id: "crm.depositPaid",
		label: "CRM - Deposit Paid",
		rules: { allowedOn: ["list"] },
		render() {
			const inner = chip({
				id: "crm-deposit",
				text: `<strong>Deposit Paid /</strong>`,
				orderTag: "metadata-tag",
				bg: colors.crmDeposit,
			});
			return wrapTemplate("crm.depositPaid", "crm-deposit", inner);
		},
	},
	paidInFull: {
		id: "crm.paidInFull",
		label: "CRM - Paid in Full",
		rules: { allowedOn: ["list"] },
		render() {
			const inner = chip({
				id: "crm-paid-full",
				text: `<strong>Paid in Full / </strong>`,
				orderTag: "metadata-tag",
				bg: colors.crmPaidFull,
			});
			return wrapTemplate("crm.paidInFull", "crm-paid-full", inner);
		},
	},
	partiallyPaid: {
		id: "crm.partiallyPaid",
		label: "CRM - Partially Paid",
		rules: { allowedOn: ["list"] },
		render() {
			const inner = chip({
				id: "crm-partially-paid",
				text: `<strong>Paid  / </strong>`,
				orderTag: "metadata-tag",
				bg: colors.crmPartially,
			});
			return wrapTemplate(
				"crm.partiallyPaid",
				"crm-partially-paid",
				inner
			);
		},
	},
	paymentPlan: {
		id: "crm.paymentPlan",
		label: "CRM - Payment Plan",
		rules: { allowedOn: ["list"] },
		render() {
			const inner = chip({
				id: "crm-payment-plan",
				text: `<strong>Payment Plan - [Number] Months - [End Date YYYY-MM-DD] - Paid  / </strong>`,
				orderTag: "metadata-tag",
				bg: colors.crmPaymentPlan,
			});
			return wrapTemplate("crm.paymentPlan", "crm-payment-plan", inner);
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
		hiddenFromDynamicCommands: true, // Block from dynamic builder
		rules: { allowedOn: ["task"] },
		render(params?: { label?: string; everyoneIcon?: string }) {
			const label = params?.label?.trim() ?? "Everyone";
			const everyoneIcon = params?.everyoneIcon ?? emojis.everyone;
			const inner = chip({
				id: "assignee",
				text: `<strong>${everyoneIcon} ${label}</strong>`,
				orderTag: "assignee",
				bg: "#FFFFFF",
				color: "#000000",
				extraAttrs: { class: "active-team internal-link" },
			});
			return wrapTemplate("members.assignee", "assignee", inner);
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
			const inner = chip({
				id: "kano-dissatisfier",
				text: `<strong>${emojis.kanoLeft} Kano - Dissatisfier</strong>`,
				orderTag: "artifact-item-type",
				bg: colors.kanoDissatisfier,
			});
			return wrapTemplate(
				"prio.kano.dissatisfier",
				"kano-dissatisfier",
				inner
			);
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
				orderTag: "artifact-item-type",
				bg: colors.kanoIndifferent,
			});
			return wrapTemplate(
				"prio.kano.indifferent",
				"kano-indifferent",
				inner
			);
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
				orderTag: "artifact-item-type",
				bg: colors.kanoBasic,
			});
			return wrapTemplate("prio.kano.basic", "kano-basic", inner);
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
				orderTag: "artifact-item-type",
				bg: colors.kanoPerformant,
			});
			return wrapTemplate(
				"prio.kano.performantHeader",
				"kano-performant-header",
				inner
			);
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
				orderTag: "artifact-item-type",
				bg: colors.kanoDelighter,
			});
			return wrapTemplate("prio.kano.delighter", "kano-delighter", inner);
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
				orderTag: "artifact-item-type",
				bg: colors.moscowCould,
			});
			return wrapTemplate("prio.moscow.could", "moscow-could", inner);
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
				orderTag: "artifact-item-type",
				bg: colors.moscowMust,
			});
			return wrapTemplate("prio.moscow.must", "moscow-must", inner);
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
				orderTag: "artifact-item-type",
				bg: colors.moscowShould,
			});
			return wrapTemplate("prio.moscow.should", "moscow-should", inner);
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
				orderTag: "artifact-item-type",
				bg: colors.moscowWont,
			});
			return wrapTemplate("prio.moscow.wont", "moscow-wont", inner);
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
				orderTag: "metadata-tag",
				bg: colors.kanoBasic, // reuse a neutral tone or create a new one if desired
			});
			return wrapTemplate("prio.nalap.adhoc", "nalap-adhoc", inner);
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
				orderTag: "metadata-tag",
				bg: colors.kanoPerformant, // neutral-ish
			});
			return wrapTemplate("prio.nalap.always", "nalap-always", inner);
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
				orderTag: "metadata-tag",
				bg: colors.crmPaidFull,
			});
			return wrapTemplate("prio.nalap.done", "nalap-done", inner);
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
				orderTag: "metadata-tag",
				bg: colors.moscowWont,
			});
			return wrapTemplate("prio.nalap.dropped", "nalap-dropped", inner);
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
				orderTag: "metadata-tag",
				bg: colors.moscowShould,
			});
			return wrapTemplate("prio.nalap.later", "nalap-later", inner);
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
				orderTag: "metadata-tag",
				bg: colors.moscowMust,
			});
			return wrapTemplate("prio.nalap.now", "nalap-now", inner);
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
			const inner = chip({
				id: "wf-pr",
				text: `<strong>${anchorOpen}${emojis.pr} </a></strong>`,
				orderTag: "metadata-tag",
				bg: colors.black,
				color: colors.textGrey,
			});
			return wrapTemplate("workflows.metadata.pr", "wf-pr", inner);
		},
	},
	branch: {
		id: "workflows.metadata.branch",
		label: "Workflow - Branch",
		rules: { allowedOn: ["task"] },
		render(params?: { href?: string }) {
			const href = (params?.href ?? "").trim();
			const anchorOpen = href ? `<a href="${href}">` : `<a href="">`;
			const inner = chip({
				id: "wf-branch",
				text: `<strong>${anchorOpen}${emojis.branch} </a></strong>`,
				orderTag: "metadata-tag",
				bg: colors.black,
				color: colors.textGrey,
			});
			return wrapTemplate(
				"workflows.metadata.branch",
				"wf-branch",
				inner
			);
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
			const inner = chip({
				id: "wf-link-to-artifact",
				text: `<strong><a class="internal-link" href="${href}">${text}</a></strong>`,
				orderTag: "metadata-tag",
				bg: colors.black,
				color: colors.textGrey,
			});
			return wrapTemplate(
				"workflows.metadata.linkToArtifact",
				"wf-link-to-artifact",
				inner
			);
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
			const inner = chip({
				id: "state-blocked",
				text: `⛔ Requires: ${anchorOpen}<strong>${requires}</strong></a>`,
				orderTag: "metadata-tag",
				bg: colors.statesBlocked,
			});
			return wrapTemplate(
				"workflows.states.blocked",
				"state-blocked",
				inner
			);
		},
	},
	pending: {
		id: "workflows.states.pending",
		label: "Workflow - State: Pending",
		rules: { allowedOn: ["task"] },
		render(params?: { resumes?: string }) {
			const resumes = (params?.resumes ?? "").trim();
			const inner = chip({
				id: "state-pending",
				text: `🕒 Resumes: <strong>${resumes}</strong>`,
				orderTag: "metadata-tag",
				bg: colors.statesPending,
			});
			return wrapTemplate(
				"workflows.states.pending",
				"state-pending",
				inner
			);
		},
	},
	waiting: {
		id: "workflows.states.waiting",
		label: "Workflow - State: Waiting",
		rules: { allowedOn: ["task"] },
		render(params?: { for?: string }) {
			const forWho = (params?.for ?? "").trim();
			const inner = chip({
				id: "state-waiting",
				text: `⌛ For: <strong>${forWho}</strong>`,
				orderTag: "metadata-tag",
				bg: colors.statesWaiting,
			});
			return wrapTemplate(
				"workflows.states.waiting",
				"state-waiting",
				inner
			);
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
			const inner = chip({
				id: "agile-review",
				text: `Awaiting Review from ${teamMember}`,
				orderTag: "metadata-tag",
				bg: `linear-gradient(to right, ${colors.reviewFrom}, ${colors.reviewTo})`,
				color: colors.reviewText,
			});
			return wrapTemplate(
				"workflows.states.review",
				"agile-review",
				inner
			);
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
			const inner = chip({
				id: "obsidian-internal-link",
				text: `<a href="${href}" class="internal-link">${linkContent}</a>`,
				orderTag: "metadata-tag",
				bg: colors.obsidianTagGrey,
			});
			return wrapTemplate(
				"obsidian.internalInlineLink",
				"obsidian-internal-link",
				inner
			);
		},
	},
	timestamp: {
		id: "obsidian.timestamp",
		label: "Obsidian - Timestamp",
		rules: { allowedOn: ["any"] },
		render() {
			const inner = chip({
				id: "obsidian-timestamp",
				text: `<strong>${emojis.timestamp} {{date:YYYY-MM-DD HH:MM:SS}}</strong>`,
				orderTag: "metadata-tag",
				bg: colors.obsidianTagGrey,
			});
			return wrapTemplate(
				"obsidian.timestamp",
				"obsidian-timestamp",
				inner
			);
		},
	},
	datestamp: {
		id: "obsidian.datestamp",
		label: "Obsidian - Datestamp",
		rules: { allowedOn: ["any"] },
		render() {
			const inner = chip({
				id: "obsidian-datestamp",
				text: `<strong>${emojis.datestamp} {{date:YYYY-MM-DD}}</strong>`,
				orderTag: "metadata-tag",
				bg: colors.obsidianTagGrey,
			});
			return wrapTemplate(
				"obsidian.datestamp",
				"obsidian-datestamp",
				inner
			);
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
