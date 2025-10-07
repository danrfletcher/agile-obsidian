import type { AllowedOn, Rule, RuleObject, TemplateContext } from "./types";
import {
	isTaskLine as taskLineFromCtx,
	isListLine as listLineFromCtx,
} from "@platform/obsidian";

/**
 * Error thrown when rules are not satisfied for a given context.
 */
export class RulesViolationError extends Error {
	code = "NOT_ALLOWED_HERE";
	messages: string[];
	ancestors: string[];

	constructor(messages: string[], ancestors: string[] = []) {
		super("Rule evaluation failed");
		this.name = "RulesViolationError";
		this.messages = messages;
		this.ancestors = ancestors;
	}
}

export function normalizeRules(rule?: Rule): RuleObject[] {
	if (!rule) return [];
	return Array.isArray(rule) ? rule : [rule];
}

export function matchesAllowedOn(line: string, allowed?: AllowedOn[]): boolean {
	if (!allowed || allowed.length === 0) return true;
	if (allowed.includes("any")) return true;

	const isTask = taskLineFromCtx(line);
	const isList = listLineFromCtx(line) && !isTask;

	if (isTask && allowed.includes("task")) return true;
	if (isList && allowed.includes("list")) return true;
	return false;
}

export function validateTopLevel(
	ancestors: string[],
	mustTopLevel?: boolean
): boolean {
	if (!mustTopLevel) return true;
	return ancestors.length === 0;
}

export function validateParent(
	ancestors: string[],
	parents?: string[]
): boolean {
	if (!parents || parents.length === 0) return true;
	const nearest = ancestors[0];
	return !!nearest && parents.includes(nearest);
}

/**
 Core rule evaluator. Throws RulesViolationError with details on failure.
*/
export function evaluateRules(
	ctx: TemplateContext,
	rule: Rule | undefined,
	getAncestors: (ctx: TemplateContext) => string[]
) {
	const list = normalizeRules(rule);
	if (list.length === 0) return;

	const ancestors = getAncestors(ctx);
	const messages: string[] = [];

	for (const r of list) {
		const allowedOk = matchesAllowedOn(ctx.line, r.allowedOn);
		const topOk = validateTopLevel(ancestors, r.topLevel);
		const parentOk = validateParent(ancestors, r.parent);

		if (allowedOk && topOk && parentOk) return; // satisfied by this variant
		else {
			if (!allowedOk)
				messages.push("Not allowed on this line type (task vs list).");
			if (!topOk)
				messages.push("This template must be at the top level.");
			if (!parentOk)
				messages.push(
					`Missing required parent. Requires one of: [${(
						r.parent ?? []
					).join(", ")}].`
				);
		}
	}

	throw new RulesViolationError(messages, ancestors);
}

/**
 Future-proof helper:
 - Returns true if any of the rule variants pass for the given context.
 - Delegates to evaluateRules to ensure any new future rules are honored automatically.
*/
export function isAllowedInContext(
	ctx: TemplateContext,
	rule: Rule | undefined,
	getAncestors: (ctx: TemplateContext) => string[]
): boolean {
	try {
		evaluateRules(ctx, rule, getAncestors);
		return true;
	} catch {
		return false;
	}
}
