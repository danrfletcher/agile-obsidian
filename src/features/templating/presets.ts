import tokensData from "./tokens.json";
import { markChip, taskLine, listLine } from "./htmlPartials";

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
export const Agile = {
	initiative(): string {
		return taskLine(
			chip({
				id: "agile-initiative",
				text: `<strong>${emojis.initiative} </strong>`,
				orderTag: "artifact-item-type",
				bg: colors.artifactGrey,
			})
		);
	},

	epic(): string {
		return taskLine(
			chip({
				id: "agile-epic",
				text: `<strong>${emojis.epic} </strong>`,
				orderTag: "artifact-item-type",
				bg: colors.artifactGrey,
			})
		);
	},

	feature(): string {
		return taskLine(
			chip({
				id: "agile-feature",
				text: `<strong>${emojis.feature} :</strong>`,
				orderTag: "artifact-item-type",
				bg: colors.artifactGrey,
			})
		);
	},

	product(): string {
		return taskLine(
			chip({
				id: "agile-product",
				text: `<strong>${emojis.product} </strong>`,
				orderTag: "artifact-item-type",
				bg: colors.artifactGrey,
			})
		);
	},

	userStory: {
		id: "agile.userStory",
		label: "Agile - User Story",
		// rules: { allowedOn: ["task"], parent: ["agile.epic", "agile.personalLearningEpic"] },
		render(params?: {
			persona?: string;
			desire?: string;
			outcome?: string;
		}) {
			const persona = params?.persona ?? "";
			const desire = params?.desire ?? "";
			const outcome = params?.outcome ?? "";

			// Build the dynamic clause only if all three fields are present
			const clause =
				persona && desire && outcome
					? ` **As a** ${persona} , **I want to** ${desire} , **so that** ${outcome}`
					: "";

			const text = `<strong>${emojis.story}${clause ? " :" : ""}</strong>${clause}`;

			return taskLine(
				chip({
					id: "agile-user-story",
					text,
					orderTag: "artifact-item-type",
					bg: `linear-gradient(to right, ${colors.userStoryFrom}, ${colors.userStoryTo})`,
				})
			);
		},
	},

	acceptanceCriteria(): string {
		return taskLine(
			chip({
				id: "agile-acceptance",
				text: `<strong>${emojis.accept} :</strong>`,
				orderTag: "artifact-item-type",
				bg: colors.artifactGrey,
			})
		);
	},

	kpi(): string {
		return taskLine(
			chip({
				id: "agile-kpi",
				text: `<strong>${emojis.kpi} </strong>`,
				orderTag: "artifact-item-type",
				bg: colors.artifactGrey,
			})
		);
	},

	okr(): string {
		return taskLine(
			chip({
				id: "agile-okr",
				text: `<strong>${emojis.okr} </strong>`,
				orderTag: "artifact-item-type",
				bg: `linear-gradient(to left, ${colors.okrFrom}, ${colors.okrTo})`,
			})
		);
	},

	kpiLink(): string {
		return taskLine(
			chip({
				id: "agile-kpi-link",
				text: `<strong>${emojis.artifactLink.replace(
					"[emoji]",
					"🔁"
				)}</strong>`,
				orderTag: "artifact-item-type",
				bg: colors.black,
				color: colors.textGrey,
				href: "", // user to fill
			})
		);
	},

	artifactParentLink(): string {
		// rendered as a link wrapping a mark chip; orderTag is parent-link
		return taskLine(
			chip({
				id: "agile-artifact-parent-link",
				text: `${emojis.linkArrowUp}`,
				orderTag: "parent-link",
				href: "", // to be resolved by engine
			})
		);
	},

	review(): string {
		// "- [R] <mark ...>Review</mark> ↪️Assign third-party to Review Following Completion"
		const mark = chip({
			id: "agile-review",
			text: `${emojis.reviewTag}`,
			orderTag: "artifact-item-type",
			bg: `linear-gradient(to right, ${colors.reviewFrom}, ${colors.reviewTo})`,
			color: colors.reviewText,
		});
		return `- [R] ${mark} ${emojis.reviewArrow}Assign third-party to Review Following Completion`;
	},

	personalLearningInitiative(): string {
		return taskLine(
			chip({
				id: "agile-personal-learning-initiative",
				text: `<strong>${emojis.learningGrad} </strong>`,
				orderTag: "artifact-item-type",
				bg: `linear-gradient(to right, ${colors.personalInitFrom}, ${colors.personalInitTo})`,
				color: "#FFFFFF",
			})
		);
	},

	personalLearningEpic(): string {
		return taskLine(
			chip({
				id: "agile-personal-learning-epic",
				text: `<strong>${emojis.learningBook} </strong>`,
				orderTag: "artifact-item-type",
				bg: `linear-gradient(to right, ${colors.personalEpicFrom}, ${colors.personalEpicTo})`,
				color: "#FFFFFF",
			})
		);
	},
};

/**
 * CRM — tasks or lists
 * orderTag: "metadata-tag"
 */
export const CRM = {
	abandoned(): string {
		return listLine(
			chip({
				id: "crm-abandoned",
				text: `<strong>Abandoned</strong>`,
				orderTag: "metadata-tag",
				bg: colors.crmAbandoned,
			})
		);
	},
	awaitingDeposit(): string {
		return listLine(
			chip({
				id: "crm-awaiting-deposit",
				text: `<strong>Awaiting Deposit</strong>`,
				orderTag: "metadata-tag",
				bg: colors.crmAwaiting,
			})
		);
	},
	commission(): string {
		return listLine(
			chip({
				id: "crm-commission",
				text: `<strong>Commission Paid /</strong>`,
				orderTag: "metadata-tag",
				bg: colors.crmCommission,
			})
		);
	},
	depositPaid(): string {
		return listLine(
			chip({
				id: "crm-deposit",
				text: `<strong>Deposit Paid /</strong>`,
				orderTag: "metadata-tag",
				bg: colors.crmDeposit,
			})
		);
	},
	paidInFull(): string {
		return listLine(
			chip({
				id: "crm-paid-full",
				text: `<strong>Paid in Full / </strong>`,
				orderTag: "metadata-tag",
				bg: colors.crmPaidFull,
			})
		);
	},
	partiallyPaid(): string {
		return listLine(
			chip({
				id: "crm-partially-paid",
				text: `<strong>Paid  / </strong>`,
				orderTag: "metadata-tag",
				bg: colors.crmPartially,
			})
		);
	},
	paymentPlan(): string {
		return listLine(
			chip({
				id: "crm-payment-plan",
				text: `<strong>Payment Plan - [Number] Months - [End Date YYYY-MM-DD] - Paid  / </strong>`,
				orderTag: "metadata-tag",
				bg: colors.crmPaymentPlan,
			})
		);
	},
};

/**
 * Members — tasks only
 * orderTag: "assignee"
 * Assumes you already have logic for `assignedPerson`.
 */
export const Members = {
	assignee(label = "🤝 Everyone"): string {
		return taskLine(
			chip({
				id: "assignee",
				text: `<strong>${emojis.everyone} Everyone</strong>`,
				orderTag: "assignee",
				bg: "#FFFFFF",
				color: "#000000",
				extraAttrs: { class: "active-team internal-link" },
			})
		);
	},
};
/**
 * Prioritization — lists only
 * orderTag: "artifact-item-type"
 */
export const Prioritization = {
	// Kano sections
	kanoDissatisfierHeader(): string {
		return listLine(
			chip({
				id: "kano-dissatisfier-header",
				text: `<strong>${emojis.kanoLeft} Kano - Dissatisfier</strong>`,
				orderTag: "artifact-item-type",
				bg: colors.kanoDissatisfier,
			})
		);
	},
	kanoDissatisfierInfo(): string {
		return listLine(
			chip({
				id: "kano-dissatisfier-info",
				text: `${emojis.kanoLeft} `,
				orderTag: "artifact-item-type",
				bg: colors.kanoDissatisfier,
			})
		);
	},
	kanoIndifferentHeader(): string {
		return listLine(
			chip({
				id: "kano-indifferent-header",
				text: `<strong>${emojis.kanoIndiff} Kano - Indifferent</strong>`,
				orderTag: "artifact-item-type",
				bg: colors.kanoIndifferent,
			})
		);
	},
	kanoIndifferentInfo(): string {
		return listLine(
			chip({
				id: "kano-indifferent-info",
				text: `${emojis.kanoIndiff} `,
				orderTag: "artifact-item-type",
				bg: colors.kanoIndifferent,
			})
		);
	},
	kanoBasicHeader(): string {
		return listLine(
			chip({
				id: "kano-basic-header",
				text: `<strong>${emojis.kanoBasic} Kano - Basic</strong>`,
				orderTag: "artifact-item-type",
				bg: colors.kanoBasic,
			})
		);
	},
	kanoBasicInfo(): string {
		return listLine(
			chip({
				id: "kano-basic-info",
				text: `${emojis.kanoBasic} `,
				orderTag: "artifact-item-type",
				bg: colors.kanoBasic,
			})
		);
	},
	kanoPerformantHeader(): string {
		return listLine(
			chip({
				id: "kano-performant-header",
				text: `<strong>${emojis.kanoPerf} Kano - Performant</strong>`,
				orderTag: "artifact-item-type",
				bg: colors.kanoPerformant,
			})
		);
	},
	kanoPerformantInfo(): string {
		return listLine(
			chip({
				id: "kano-performant-info",
				text: `${emojis.kanoPerf} `,
				orderTag: "artifact-item-type",
				bg: colors.kanoPerformant,
			})
		);
	},
	kanoDelighterHeader(): string {
		return listLine(
			chip({
				id: "kano-delighter-header",
				text: `<strong>${emojis.kanoDelight} Kano - Delighter</strong>`,
				orderTag: "artifact-item-type",
				bg: colors.kanoDelighter,
			})
		);
	},
	kanoDelighterInfo(): string {
		return listLine(
			chip({
				id: "kano-delighter-info",
				text: `<strong>${emojis.kanoDelight} </strong>`,
				orderTag: "artifact-item-type",
				bg: colors.kanoDelighter,
			})
		);
	},

	// MoSCoW headers
	moscowCould(): string {
		return listLine(
			chip({
				id: "moscow-could",
				text: `<strong>❓ Could Have</strong>`,
				orderTag: "artifact-item-type",
				bg: colors.moscowCould,
			})
		);
	},
	moscowMust(): string {
		return listLine(
			chip({
				id: "moscow-must",
				text: `<strong>❗Must-Have</strong>`,
				orderTag: "artifact-item-type",
				bg: colors.moscowMust,
			})
		);
	},
	moscowShould(): string {
		return listLine(
			chip({
				id: "moscow-should",
				text: `<strong>🎁 Should Have</strong>`,
				orderTag: "artifact-item-type",
				bg: colors.moscowShould,
			})
		);
	},
	moscowWont(): string {
		return listLine(
			chip({
				id: "moscow-wont",
				text: `<strong>❌ Won’t Have</strong>`,
				orderTag: "artifact-item-type",
				bg: colors.moscowWont,
			})
		);
	},

	// NALAp
	nalapAdhoc(): string {
		return listLine(
			`📂 **Adhoc** ${chip({
				id: "nalap-adhoc",
				text: "",
				orderTag: "artifact-item-type",
			})}`
		);
	},
	nalapAlways(): string {
		return listLine(
			`📍 **Always** ${chip({
				id: "nalap-always",
				text: "",
				orderTag: "artifact-item-type",
			})}`
		);
	},
	nalapDone(): string {
		return listLine(
			`✅ **Done** ${chip({
				id: "nalap-done",
				text: "",
				orderTag: "artifact-item-type",
			})}`
		);
	},
	nalapDropped(): string {
		return listLine(
			`❌ **Dropped** ${chip({
				id: "nalap-dropped",
				text: "",
				orderTag: "artifact-item-type",
			})}`
		);
	},
	nalapLater(): string {
		return listLine(
			`🛠️ **Later** ${chip({
				id: "nalap-later",
				text: "",
				orderTag: "artifact-item-type",
			})}`
		);
	},
	nalapNow(): string {
		return listLine(
			`🚀 **Now** ${chip({
				id: "nalap-now",
				text: "",
				orderTag: "artifact-item-type",
			})}`
		);
	},
};

/**
 * Workflows
 * - Metadata — tasks only, orderTag: "metadata-tag"
 * - States — tasks only, orderTag: "metadata-tag"
 */
export const Workflows = {
	// Metadata
	pr(): string {
		return taskLine(
			chip({
				id: "wf-pr",
				text: `<strong><a href="">${emojis.pr} </a></strong>`,
				orderTag: "metadata-tag",
				bg: colors.black,
				color: colors.textGrey,
			})
		);
	},
	branch(): string {
		return taskLine(
			chip({
				id: "wf-branch",
				text: `<strong><a href="">${emojis.branch} </a></strong>`,
				orderTag: "metadata-tag",
				bg: colors.black,
				color: colors.textGrey,
			})
		);
	},
	linkToArtifact(): string {
		return taskLine(
			chip({
				id: "wf-link-to-artifact",
				text: `<strong><a class="internal-link" href="Artifact-block-link-with-no-square-brackets">🔗</a></strong>`,
				orderTag: "metadata-tag",
				bg: colors.black,
				color: colors.textGrey,
			})
		);
	},

	// States
	blocked(): string {
		return taskLine(
			chip({
				id: "state-blocked",
				text: `⛔ Requires: <a class="internal-link" href=""><strong></strong></a>`,
				orderTag: "metadata-tag",
				bg: colors.statesBlocked,
			})
		);
	},
	pending(): string {
		return taskLine(
			chip({
				id: "state-pending",
				text: `🕒 Resumes: <strong></strong>`,
				orderTag: "metadata-tag",
				bg: colors.statesPending,
			})
		);
	},
	waiting(): string {
		return taskLine(
			chip({
				id: "state-waiting",
				text: `⌛ For: <strong></strong>`,
				orderTag: "metadata-tag",
				bg: colors.statesWaiting,
			})
		);
	},
};

/**
 * Obsidian Extensions — can be inserted on tasks, lists, or outside both
 * orderTag: varies ("metadata-tag" here for links/timestamps, or choose "extension-tag")
 */
export const ObsidianExtensions = {
	internalInlineLink(): string {
		return chip({
			id: "obsidian-internal-link",
			text: `<a href="" class="internal-link"></a>`,
			orderTag: "metadata-tag",
			bg: colors.obsidianTagGrey,
		});
	},
	timestamp(): string {
		return chip({
			id: "obsidian-timestamp",
			text: `<strong>🕔 {{date:YYYY-MM-DD HH:MM:SS}}</strong>`,
			orderTag: "metadata-tag",
			bg: colors.obsidianTagGrey,
		});
	},
	datestamp(): string {
		return chip({
			id: "obsidian-datestamp",
			text: `<strong>🕔 {{date:YYYY-MM-DD}}</strong>`,
			orderTag: "metadata-tag",
			bg: colors.obsidianTagGrey,
		});
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
