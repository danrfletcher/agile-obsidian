import { describe, expect, it } from "vitest";
import { runTemplateWorkflows } from "@features/templating-engine/domain/template-workflows";
import type { TemplateDefinition } from "@features/templating-engine/domain/types";
import { presetTemplates } from "@features/templating-engine/domain/presets";
import { makeFakeApp } from "../helpers/fake-app";

const linkDef = (
	presetTemplates as unknown as Record<string, Record<string, TemplateDefinition>>
).workflows.linkToArtifact;

const defWith = (insertWorkflows: string[]): TemplateDefinition =>
	({ id: "t", insertWorkflows }) as unknown as TemplateDefinition;

const EPIC_LINE =
	'- [ ] <span data-template-wrapper="tpl-x" data-template-key="agile.epic" data-order-tag="artifact-item-type"><mark>E</mark></span> Login ^ep1\n';

describe("runTemplateWorkflows", () => {
	it("Link to Artifact declares the on-demand lookup workflow", () => {
		expect(linkDef.insertWorkflows).toEqual(["resolveArtifactTypeFromBlockRef"]);
	});

	it("awaits the async file read and merges linkedArtifactType", async () => {
		let release!: (s: string) => void;
		const app = makeFakeApp({ files: { "Work/Auth.md": "" } });
		app.vault.cachedRead = () =>
			new Promise<string>((resolve) => {
				release = resolve;
			});

		let settled = false;
		const p = runTemplateWorkflows(
			linkDef,
			{ blockRef: "Work/Auth.md#^ep1" },
			{ app, sourcePath: "x.md" }
		).then((r) => {
			settled = true;
			return r;
		});

		await Promise.resolve();
		await Promise.resolve();
		expect(settled).toBe(false); // still waiting for the read

		release(EPIC_LINE);
		expect(await p).toEqual({
			blockRef: "Work/Auth.md#^ep1",
			linkedArtifactType: "epic",
		});
	});

	it("strips __wf_* scratch keys", async () => {
		const app = makeFakeApp({ files: { "Work/Auth.md": EPIC_LINE } });
		const out = await runTemplateWorkflows(
			defWith(["resolveTaskItemFromBlockRef"]),
			{ blockRef: "Work/Auth.md#^ep1", __wf_leftover: 1 },
			{ app }
		);
		expect(Object.keys(out).some((k) => k.startsWith("__wf_"))).toBe(false);
		expect(out.blockRef).toBe("Work/Auth.md#^ep1");

		const full = await runTemplateWorkflows(
			linkDef,
			{ blockRef: "Work/Auth.md#^ep1" },
			{ app }
		);
		expect(Object.keys(full).some((k) => k.startsWith("__wf_"))).toBe(false);
	});

	it("a step can be named on its own: the scratch item is produced then stripped", async () => {
		const app = makeFakeApp({ files: { "Work/Auth.md": EPIC_LINE } });
		const out = await runTemplateWorkflows(
			defWith(["resolveTaskItemFromBlockRef", "resolveArtifactFromTask"]),
			{ blockRef: "Work/Auth.md#^ep1" },
			{ app }
		);
		expect(out.linkedArtifactType).toBe("epic");
		expect(out).not.toHaveProperty("__wf_taskItem");
	});

	it("ignores unknown workflow names, including Object.prototype names", async () => {
		const app = makeFakeApp({ files: {} });
		const params = { blockRef: "a#^b", other: 1 };
		const out = await runTemplateWorkflows(
			defWith(["nope", "constructor", "toString", "__proto__"]),
			params,
			{ app }
		);
		expect(out).toEqual(params);
	});

	it("returns a copy and leaves the input params untouched", async () => {
		const app = makeFakeApp({ files: { "Work/Auth.md": EPIC_LINE } });
		const params = { blockRef: "Work/Auth.md#^ep1" };
		const out = await runTemplateWorkflows(linkDef, params, { app });
		expect(params).toEqual({ blockRef: "Work/Auth.md#^ep1" });
		expect(out).not.toBe(params);
	});

	it("does nothing for a template without insertWorkflows", async () => {
		const app = makeFakeApp({ files: {} });
		const out = await runTemplateWorkflows(
			{ id: "t" } as unknown as TemplateDefinition,
			{ a: 1 },
			{ app }
		);
		expect(out).toEqual({ a: 1 });
	});

	it("unresolvable target: no linkedArtifactType value, and a stale one is dropped", async () => {
		const app = makeFakeApp({ files: {} });
		const out = await runTemplateWorkflows(
			linkDef,
			{ blockRef: "Gone.md#^x", linkedArtifactType: "epic" },
			{ app }
		);
		expect(out.linkedArtifactType).toBeUndefined();
	});

	it("without an app port the type is simply absent (no throw)", async () => {
		const out = await runTemplateWorkflows(linkDef, { blockRef: "A#^b" }, {});
		expect(out.linkedArtifactType).toBeUndefined();
	});

	it("a step that rejects is skipped, not propagated", async () => {
		const app = makeFakeApp({ files: { "Work/Auth.md": EPIC_LINE } });
		app.vault.getAbstractFileByPath = () => {
			throw new Error("boom");
		};
		await expect(
			runTemplateWorkflows(linkDef, { blockRef: "Work/Auth.md#^ep1" }, { app })
		).resolves.toMatchObject({ blockRef: "Work/Auth.md#^ep1" });
	});
});
