/**
 * Agile templating presets and rule helpers.
 *
 * The engine (to be built) can call each template's rules to decide if a template is insertable
 * at a given location. We keep this file self-contained and export all helpers needed by the engine.
 */

/**
 * Whether a template may be inserted on a plain list line, a task line, or anywhere.
 */
export type AllowedOn = "list" | "task" | "any";

/**
 * Context passed to rule functions by the templating engine.
 * - parentChainTemplateIds: nearest-first chain of fully-qualified template ids applied to ancestors.
 *   Example ids: "agileArtifacts.initiative", "agileArtifacts.epic", etc.
 * - currentLineIsTask: true if the current line is a task (e.g., "- [ ]" or custom checkbox), false if just "-".
 */
export interface TemplateContext {
	parentChainTemplateIds: string[];
	currentLineIsTask: boolean;
}

/**
 * Rule function — returns true if the template can be used in the given context, false otherwise.
 */
export type RuleFn = (ctx: TemplateContext) => boolean;

/**
 * Rules for a template.
 * - parent: one or more RuleFn that must all pass. Typically used to express parent-type constraints.
 * - allowedOn: the kind of line the template may be inserted onto.
 */
export interface Rules {
	parent?: RuleFn | RuleFn[];
	allowedOn?: AllowedOn; // allows the template to be added on a list item "-" or a task item "- [ ]" or both
}

/**
 * A concrete template definition.
 */
export interface TemplateDef {
	string: string;
	rules?: Rules;
}

/**
 * Helpers to build common rule functions.
 */
export const ruleHelpers = {
	requireParent: (fqId: string): RuleFn => {
		return (ctx: TemplateContext) =>
			ctx.parentChainTemplateIds.includes(fqId);
	},
	requireParentAnyOf: (fqIds: string[]): RuleFn => {
		return (ctx: TemplateContext) =>
			fqIds.some((fq) => ctx.parentChainTemplateIds.includes(fq));
	},
	requireTopLevel: (): RuleFn => {
		return (ctx: TemplateContext) =>
			ctx.parentChainTemplateIds.length === 0;
	},
	requireTaskLine: (): RuleFn => {
		return (ctx: TemplateContext) => ctx.currentLineIsTask;
	},
	requireListLine: (): RuleFn => {
		return (ctx: TemplateContext) => !ctx.currentLineIsTask;
	},
};

/**
 * Utility to normalize a 'parent' field into an array of RuleFn and evaluate it.
 */
export function evaluateParentRules(
	parent: Rules["parent"],
	ctx: TemplateContext
): boolean {
	if (!parent) return true;
	const arr = Array.isArray(parent) ? parent : [parent];
	return arr.every((fn) => {
		try {
			return !!fn(ctx);
		} catch {
			return false;
		}
	});
}

/**
 * Fully-qualified ids used inside rules for cross-references.
 */
const FQ = {
	agile: {
		product: "agileArtifacts.product",
		initiative: "agileArtifacts.initiative",
		epic: "agileArtifacts.epic",
		userStory: "agileArtifacts.userStory",
		feature: "agileArtifacts.feature",
		personalLearningInitiative: "agileArtifacts.personalLearningInitiative",
		personalLearningEpic: "agileArtifacts.personalLearningEpic",
		acceptanceCriteria: "agileArtifacts.acceptanceCriteria",
        okr: "agileArtifacts.okr",
	},
};

/**
 * Preset templates organized to reflect hierarchy from high-level down:
 * Product > Initiative > Epic > Feature/User Story > Acceptance Criteria
 * Personal Learning Initiative > Personal Learning Epic
 */
export const presetTemplates = {
	agileArtifacts: {
		initiative: {
			string: `<mark style="background: #CACFD9A6;"><strong>🎖️ </strong></mark>`,
			rules: {
				allowedOn: "task",
			},
		},
		epic: {
			string: `<mark style="background: #CACFD9A6;"><strong>🏆 </strong></mark>`,
			rules: {
				allowedOn: "task",
				parent: ruleHelpers.requireParent(FQ.agile.initiative),
			},
		},
		userStory: {
			string: `<mark style="background: linear-gradient(to right, #00B7FF, #A890FE);"><strong>📝 :</strong></mark> **As a** , **I want to** , **so that**`,
			rules: {
				allowedOn: "task",
				parent: ruleHelpers.requireParentAnyOf([
					FQ.agile.epic,
					FQ.agile.feature,
				]),
			},
		},
		acceptanceCriteria: {
			string: `<mark style="background: #CACFD9A6;"><strong>✅ :</strong></mark>`,
			rules: {
				allowedOn: "task",
				parent: ruleHelpers.requireParent(FQ.agile.userStory),
			},
		},
		product: {
			string: `<mark style="background: #CACFD9A6;"><strong>📦 </strong></mark>`,
			rules: {
				allowedOn: "task",
				parent: ruleHelpers.requireTopLevel(),
			},
		},
		feature: {
			string: `<mark style="background: #CACFD9A6;"><strong>⭐ :</strong></mark>`,
			rules: {
				allowedOn: "task",
				parent: ruleHelpers.requireParentAnyOf([FQ.agile.product]),
			},
		},
		artifactParentLink: {
			string: `<a href="" class="internal-link">⬆️</a>`,
			rules: {
				allowedOn: "task",
			},
		},
		okr: {
			string: `<mark style="background: linear-gradient(to left, #38ADAE, #CD395A);"><strong>🎯 </strong></mark>`,
			rules: {
				allowedOn: "task",
			},
		},
		kpi: {
			string: `<mark style="background: #CACFD9A6;"><strong>🔁 </strong></mark>`,
			rules: {
				allowedOn: "task",
				parent: ruleHelpers.requireParent(FQ.agile.okr),
			},
		},
		personalLearningInitiative: {
			string: `<mark style="background: linear-gradient(to right, #2c3e50, #3498db); color: #FFFFFF"><strong>🎓 </strong></mark>`,
			rules: {
				allowedOn: "task",
			},
		},
		personalLearningEpic: {
			string: `<mark style="background: linear-gradient(to right, #f0c27b, #4b1248); color: #FFFFFF"><strong>📚 </strong></mark>`,
			rules: {
				allowedOn: "task",
				parent: ruleHelpers.requireParent(
					FQ.agile.personalLearningInitiative
				),
			},
		},
	},
	crm: {
		paymentStates: {
			abandoned: {
				string: `<mark style="background: #FF5582A6;"><strong>Abandoned</strong></mark>`,
				rules: { allowedOn: "task" },
			},
			awaitingDeposit: {
				string: `<mark style="background: #FFB86CA6;"><strong>Awaiting Deposit</strong></mark>`,
				rules: { allowedOn: "task" },
			},
			commission: {
				string: `<mark style="background: #53BDA5;"><strong>Commission Paid /</strong></mark>`,
				rules: { allowedOn: "task" },
			},
			depositPaid: {
				string: `<mark style="background: #FEE12B;"><strong>Deposit Paid /</strong></mark>`,
				rules: { allowedOn: "task" },
			},
			paidInFull: {
				string: `<mark style="background: #2E8B57;"><strong>Paid in Full / </strong></mark>`,
				rules: { allowedOn: "task" },
			},
			partiallyPaid: {
				string: `<mark style="background: #FFB86CA6;"><strong>Paid  / </strong></mark>`,
				rules: { allowedOn: "task" },
			},
			paymentPlan: {
				string: `<mark style="background: #4169E1;"><strong>Payment Plan - [Number] Months - [End Date YYYY-MM-DD] - Paid  / </strong></mark>`,
				rules: { allowedOn: "task" },
			},
		},
	},
	prioritization: {
		kano: {
			kanoL0Indifferent: {
				string: `<mark style="background: #FFB8EBA6;"><strong>🔄 Kano - Indifferent</strong></mark>`,
				rules: { allowedOn: "list" },
			},
			kanoL1BasicHeader: {
				string: `<mark style="background: #CACFD9A6;"><strong>📦 Kano - Basic</strong></mark>`,
				rules: { allowedOn: "list" },
			},
			kanoL2PerformantHeader: {
				string: `<mark style="background: #FFF3A3A6;"><strong>⚡ Kano - Performant</strong></mark>`,
				rules: { allowedOn: "list" },
			},
			kanoL3DelighterHeader: {
				string: `<mark style="background: #00A86B;"><strong>💝 Kano - Delighter</strong></mark>`,
				rules: { allowedOn: "list" },
			},
			kanoLMinus1DissatisfierHeader: {
				string: `<mark style="background: #FF5582A6;"><strong>⬅️ Kano - Dissatisfier</strong></mark>`,
				rules: { allowedOn: "list" },
			},
		},
		moSCow: {
			couldHave: {
				string: `<mark style="background: #1E90FF;"><strong>❓ Could Have</strong></mark>`,
				rules: { allowedOn: "list" },
			},
			mustHave: {
				string: `<mark style="background: #00A86B;"><strong>❗Must-Have</strong></mark>`,
				rules: { allowedOn: "list" },
			},
			shouldHave: {
				string: `<mark style="background: #FEE12B;"><strong>🎁 Should Have</strong></mark>`,
				rules: { allowedOn: "list" },
			},
			wontHave: {
				string: `<mark style="background: #ED2939;"><strong>❌ Won’t Have</strong></mark>`,
				rules: { allowedOn: "list" },
			},
		},
		nalAp: {
			adhoc: {
				string: `📂 **Adhoc**`,
				rules: { allowedOn: "list" },
			},
			always: {
				string: `📍 **Always**`,
				rules: { allowedOn: "list" },
			},
			done: {
				string: `✅ **Done**`,
				rules: { allowedOn: "list" },
			},
			dropped: {
				string: `❌ **Dropped**`,
				rules: { allowedOn: "list" },
			},
			later: {
				string: `🛠️ **Later**`,
				rules: { allowedOn: "list" },
			},
			now: {
				string: `🚀 **Now**`,
				rules: { allowedOn: "list" },
			},
		},
	},
	workflows: {
		dates: {
			deadline: {
				string: ` 🎯`,
				rules: { allowedOn: "task" },
			},
			snooze: {
				string: `💤`,
				rules: { allowedOn: "task" },
			},
		},
		metadata: {
			branch: {
				string: `<mark style="background: ${
					branchColor ?? "#000000"
				}; color: 878787"><strong><a href="">🪵 </a></strong></mark>`,
				rules: { allowedOn: "any" },
			},
			linkToArtifact: {
				string: `<mark style="background: ${
					linkToArtifactColor ?? "#000000"
				}; color: 878787"><strong><a class="internal-link" href="${artifact}-block-link-with-no-square-brackets">🔗[emoji]</a></strong></mark>`, // Link to OKR by replacing Artifact with OKR
				rules: { allowedOn: "task" },
			},
		},
		states: {
			blocked: {
				string: `<mark style="background: ${
					blockedColor ?? "#FF5582A6"
				};">⛔ Requires: <a class="internal-link" href=""><strong>${taskOrPlaceholder}</strong></a></mark>`,
				rules: { allowedOn: "task" },
			},
			pending: {
				string: `<mark style="background: #FEE12B;">🕒 Resumes: <strong></strong></mark>`,
				rules: { allowedOn: "task" },
			},
			waiting: {
				string: `<mark style="background: #D2B3FFA6;">⌛ For: <strong>${taskOrPlaceholder}</strong></mark>`,
				rules: { allowedOn: "task" },
			},
		},
	},
	obsidianExtensions: {
		internalInlineLink: {
			string: `<a href="" class="internal-link"></a>`,
			rules: { allowedOn: "any" },
		},
	},
};
