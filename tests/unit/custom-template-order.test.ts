import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normalizeTaskLine } from "@features/task-canonical-formatter";
import { findAllWrappers } from "@features/task-canonical-formatter/domain/html/canonical-html-scanner";
import {
	disposeCustomTemplates,
	reloadCustomTemplates,
	setCustomTemplateSource,
} from "@features/templating-engine/app/custom-templates";
import { renderTemplateOnly } from "@features/templating-engine/app/templating-service";
import { setDefaultTemplatesEnabled } from "@features/templating-engine/app/template-registry";

/**
 * E6 (a regression check against PR-3): a chip whose custom template was deleted keeps its
 * place by data-order-tag when the formatter runs, and nothing is lost.
 */

const card = (id: string, orderTag: string) =>
	JSON.stringify({ id, label: id, orderTag, text: id.toUpperCase() });

let cards: string[] = [];

beforeEach(() => {
	cards = [];
	setCustomTemplateSource(() => cards);
	setDefaultTemplatesEnabled(true);
	reloadCustomTemplates();
});
afterEach(() => {
	disposeCustomTemplates();
	setDefaultTemplatesEnabled(true);
});

const chip = (key: string, tag: string, text: string) =>
	`<span data-template-wrapper="w-${key}" data-template-key="${key}" data-order-tag="${tag}"><mark>${text}</mark></span>`;

describe("E6: a deleted custom template's chip keeps its place by data-order-tag", () => {
	const epic = chip("agile.epic", "artifact-item-type", "Epic");
	const parent = chip("agile.parentLink", "parent-link", "Parent");
	const done = chip("agile.status", "state", "Done");

	for (const tag of ["artifact-item-type", "parent-link", "state", "metadata"]) {
		it(`tag ${tag}: same output whether the template is loaded or deleted, nothing lost`, () => {
			const custom = chip("custom.gone", tag, "GONE");
			// Written out of canonical order on purpose, with the custom chip in the middle.
			const line = `- [ ] Task ${done} ${custom} ${parent} ${epic} tail`;

			cards = [card("custom.gone", tag)];
			reloadCustomTemplates();
			const whileLoaded = normalizeTaskLine(line);

			cards = []; // deleted
			reloadCustomTemplates();
			const afterDelete = normalizeTaskLine(line);

			expect(afterDelete).toBe(whileLoaded);
			expect(afterDelete).not.toBe(line); // the formatter did reorder something
			expect(findAllWrappers(afterDelete).sort()).toEqual(
				findAllWrappers(line).sort()
			);
			expect(afterDelete).toContain(custom);
			expect(afterDelete).toContain("tail");

			// Its place is decided by its tag alone: the tag sequence is the same for a
			// reversed input line, and a second pass changes nothing.
			const tagSeq = (l: string) =>
				[...l.matchAll(/data-order-tag="([^"]+)"/g)].map((m) => m[1]);
			const reversed = `- [ ] Task ${epic} ${parent} ${custom} ${done} tail`;
			expect(tagSeq(normalizeTaskLine(reversed))).toEqual(tagSeq(afterDelete));
			expect(normalizeTaskLine(afterDelete)).toBe(afterDelete);
		});
	}

	it("a chip rendered by a custom template, then orphaned, is formatted byte-for-byte like one that is live", () => {
		cards = [card("custom.gone", "state")];
		reloadCustomTemplates();
		const rendered = renderTemplateOnly("custom.gone", {});
		const line = `- [ ] Task ${rendered} ${epic()}`;
		function epic() {
			return chip("agile.epic", "artifact-item-type", "Epic");
		}
		const live = normalizeTaskLine(line);
		cards = [];
		reloadCustomTemplates();
		expect(normalizeTaskLine(line)).toBe(live);
		expect(findAllWrappers(live)).toContain(rendered);
	});
});
