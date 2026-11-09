import { describe, expect, it } from "vitest";
import { getAgileArtifactType } from "@features/templating-engine/domain/artifact-type";
import fixture from "../fixtures/artifact-type.json";

type Input = { text: string; status?: string };

describe("getAgileArtifactType (copied from task-filter) matches 5a90994, except custom ids (E13/I5)", () => {
	it.each(Object.entries(fixture))("%s", (_name, entry) => {
		const e = entry as { input: Input; result: string | null };
		expect(
			getAgileArtifactType(
				e.input as unknown as Parameters<typeof getAgileArtifactType>[0]
			)
		).toBe(e.result);
	});

	const chip = (key: string) =>
		`<span data-template-wrapper="tpl-x" data-template-key="${key}" data-order-tag="artifact-item-type"><mark>x</mark></span>`;
	const task = (text: string, status = " ") =>
		({ text, status } as unknown as Parameters<
			typeof getAgileArtifactType
		>[0]);

	it("classifies Epic, Story, Initiative and OKR chips", () => {
		expect(getAgileArtifactType(task(`${chip("agile.epic")} a`))).toBe("epic");
		expect(getAgileArtifactType(task(`${chip("agile.userStory")} a`))).toBe(
			"story"
		);
		expect(getAgileArtifactType(task(`${chip("agile.initiative")} a`))).toBe(
			"initiative"
		);
		expect(getAgileArtifactType(task(`${chip("agile.okr")} a`))).toBe("okr");
	});

	it("a non-artefact chip on an open task is not an artefact; plain text depends on status", () => {
		expect(
			getAgileArtifactType(task(`${chip("crm.abandoned")} Lost`, "O"))
		).toBeNull();
		expect(getAgileArtifactType(task("Just a plain task", "O"))).toBeNull();
		expect(getAgileArtifactType(task("Just a plain task", " "))).toBe("task");
	});
});
