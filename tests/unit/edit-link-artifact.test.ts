import { describe, expect, it } from "vitest";
import { editTemplateParamsOnDashboard } from "@features/templating-params-editor/app/edit-template-params";
import type { AppDeps } from "@features/templating-params-editor/app/ports";
import { findTemplateById } from "@features/templating-engine/app/templating-service";
import { renderTemplateWithWorkflows } from "@features/templating-engine/app/render-with-workflows";
import { presetTemplates } from "@features/templating-engine/domain/presets";
import type { LinkTarget } from "@features/templating-engine/domain/link-artifact-resolver";
import { makeFakeApp, type FakeApp } from "../helpers/fake-app";

const KEY = "workflows.metadata.linkToArtifact";

const chip = (id: string, params?: Record<string, unknown>) =>
	(
		Object.values(presetTemplates)
			.flatMap((g) => Object.values(g as Record<string, unknown>))
			.find((d) => (d as { id: string }).id === id) as {
			render: (p?: Record<string, unknown>) => string;
		}
	).render(params);

const EPIC = chip("agile.epic", { title: "Login" });
const STORY = chip("agile.userStory", {
	title: "T",
	persona: "p",
	desire: "d",
	outcome: "o",
});

/** A link chip as it would sit in a note, with a fixed instance id. */
const linkChip = (instanceId: string, blockRef: string, type?: string) =>
	chip(KEY, { blockRef, linkedArtifactType: type }).replace(
		/data-template-wrapper="[^"]*"/,
		`data-template-wrapper="${instanceId}"`
	);

const wrapperEl = { ownerDocument: null } as unknown as HTMLElement;

type Harness = {
	notes: Map<string, string>;
	writes: string[];
	deps: AppDeps;
	events: string[];
};

/**
 * Edit deps wired like the real templating port (renderTemplateOnly goes through the
 * real renderTemplateWithWorkflows against the fake app); only the modal is faked.
 */
function harness(
	app: FakeApp,
	notes: Record<string, string>,
	prefillRef: string,
	modalRef: () => Promise<string | undefined> | string | undefined,
	events: string[] = []
): Harness {
	const store = new Map(Object.entries(notes));
	const writes: string[] = [];
	const deps: AppDeps = {
		templating: {
			findTemplateById: (id) => {
				const def = findTemplateById(id);
				return def
					? {
							id: def.id,
							hasParams: !!def.hasParams,
							paramsSchema: def.paramsSchema,
					  }
					: undefined;
			},
			prefillTemplateParams: () => ({ blockRef: prefillRef }),
			showSchemaModal: async () => {
				const ref = await modalRef();
				events.push("modal");
				return ref === undefined ? undefined : { blockRef: ref };
			},
			showJsonModal: () => Promise.resolve(undefined),
			renderTemplateOnly: async (id, params, ctx) => {
				const html = await renderTemplateWithWorkflows(
					app,
					id,
					params,
					ctx?.sourcePath ?? ""
				);
				events.push("rendered");
				return html;
			},
		},
		vault: {
			readFile: (p) => {
				const c = store.get(p);
				return c === undefined
					? Promise.reject(new Error("nf"))
					: Promise.resolve(c);
			},
			writeFile: (p, c) => {
				events.push("write");
				store.set(p, c);
				writes.push(p);
				return Promise.resolve();
			},
		},
		refresh: { refreshForFile: () => Promise.resolve() },
	};
	return { notes: store, writes, deps, events };
}

const edit = (h: Harness, filePath: string, instanceId: string) =>
	editTemplateParamsOnDashboard(
		{ wrapperEl, templateKey: KEY, instanceId },
		{ filePath, lineHint0: 0 },
		h.deps
	);

describe("edit Link to Artifact: lookup is awaited before the chip is rendered", () => {
	it("waits for the target read, then writes the typed chip", async () => {
		const app = makeFakeApp({
			files: { "Work/Auth.md": `- [ ] ${EPIC} Login ^ep1\n` },
		});
		const events: string[] = [];
		let release!: () => void;
		app.vault.cachedRead = async (f: LinkTarget) => {
			events.push("read-start");
			await new Promise<void>((r) => (release = r));
			events.push("read-end");
			return app.readNow(f);
		};
		const h = harness(
			app,
			{ "n.md": `- [ ] Task ${linkChip("tpl-aaa", "Old#^x")} ^t1\n` },
			"Old#^x",
			() => "Auth#^ep1",
			events
		);

		const p = edit(h, "n.md", "tpl-aaa");
		await new Promise((r) => setTimeout(r, 5));
		expect(events).toEqual(["modal", "read-start"]);
		expect(h.writes).toEqual([]);

		release();
		await p;
		expect(events).toEqual(["modal", "read-start", "read-end", "rendered", "write"]);
		const out = h.notes.get("n.md")!;
		expect(out).toContain('data-linked-artifact-type="epic"');
		expect(out).toContain('data-template-wrapper="tpl-aaa"');
		expect(out).toContain("🔗");
	});

	it("uses the blockRef the user just saved, not the prefilled one", async () => {
		const app = makeFakeApp({
			files: {
				"Work/Auth.md": `- [ ] ${EPIC} Login ^ep1\n`,
				"Work/Billing.md": `- [ ] ${STORY} Pay ^st1\n`,
			},
		});
		const h = harness(
			app,
			{
				"n.md": `- [ ] Task ${linkChip("tpl-aaa", "Auth#^ep1", "epic")} ^t1\n`,
			},
			"Auth#^ep1", // prefilled: an Epic
			() => "Billing#^st1" // saved: a Story
		);
		await edit(h, "n.md", "tpl-aaa");
		const out = h.notes.get("n.md")!;
		expect(out).toContain('data-linked-artifact-type="story"');
		expect(out).not.toContain('data-linked-artifact-type="epic"');
		expect(app.reads).toEqual(["Work/Billing.md"]);
	});

	it("editing to a deleted target removes the stale type; no throw", async () => {
		const app = makeFakeApp({ files: {} });
		const h = harness(
			app,
			{
				"n.md": `- [ ] Task ${linkChip("tpl-aaa", "Auth#^ep1", "epic")} ^t1\n`,
			},
			"Auth#^ep1",
			() => "Auth#^ep1" // saved unchanged, but Auth.md is gone
		);
		expect(h.notes.get("n.md")).toContain('data-linked-artifact-type="epic"');
		await expect(edit(h, "n.md", "tpl-aaa")).resolves.toBeUndefined();
		const out = h.notes.get("n.md")!;
		expect(out).not.toContain("data-linked-artifact-type");
		expect(out).toContain("<a class=\"internal-link\"");
		expect(out).toContain(">🔗</a>");
	});

	it("editing to a plain (non-artefact) block drops the type attribute", async () => {
		const app = makeFakeApp({
			files: {
				"Work/Auth.md": `- [ ] ${EPIC} Login ^ep1\n`,
				"Scratch/plain.md": "- [ ] Wire SSO ^p1\n",
			},
		});
		const h = harness(
			app,
			{ "n.md": `${linkChip("tpl-aaa", "Auth#^ep1", "epic")}\n` },
			"Auth#^ep1",
			() => "plain#^p1"
		);
		await edit(h, "n.md", "tpl-aaa");
		expect(h.notes.get("n.md")).not.toContain("data-linked-artifact-type");
	});

	it("a rejecting read still writes the chip, without a type", async () => {
		const app = makeFakeApp({
			files: { "Work/Auth.md": `- [ ] ${EPIC} Login ^ep1\n` },
			failRead: ["Work/Auth.md"],
		});
		const h = harness(
			app,
			{ "n.md": `${linkChip("tpl-aaa", "x#^y")}\n` },
			"x#^y",
			() => "Work/Auth.md#^ep1"
		);
		await edit(h, "n.md", "tpl-aaa");
		const out = h.notes.get("n.md")!;
		expect(out).not.toContain("data-linked-artifact-type");
		expect(out).toContain("Work/Auth.md#^ep1");
	});

	it("two interleaved edits of two Link chips each get their own target's type", async () => {
		const app = makeFakeApp({
			files: {
				"Work/Auth.md": `- [ ] ${EPIC} Login ^ep1\n`,
				"Work/Billing.md": `- [ ] ${STORY} Pay ^st1\n`,
			},
		});
		const pending = new Map<string, () => void>();
		app.vault.cachedRead = (f: LinkTarget) =>
			new Promise<string>((resolve, reject) => {
				pending.set(f.path, () => {
					void app.readNow(f).then(resolve, reject);
				});
			});

		const h = harness(
			app,
			{
				"a.md": `${linkChip("tpl-aaa", "Old#^x")}\n`,
				"b.md": `${linkChip("tpl-bbb", "Old#^x")}\n`,
			},
			"Old#^x",
			// the modal answers by the order the edits were started
			(() => {
				const answers = ["Auth#^ep1", "Billing#^st1"];
				return () => answers.shift();
			})()
		);

		const pa = edit(h, "a.md", "tpl-aaa");
		const pb = edit(h, "b.md", "tpl-bbb");
		await new Promise((r) => setTimeout(r, 5));
		expect([...pending.keys()].sort()).toEqual([
			"Work/Auth.md",
			"Work/Billing.md",
		]);

		// resolve out of order: b's lookup finishes before a's
		pending.get("Work/Billing.md")!();
		await pb;
		expect(h.notes.get("b.md")).toContain('data-linked-artifact-type="story"');
		expect(h.notes.get("a.md")).not.toContain("data-linked-artifact-type");

		pending.get("Work/Auth.md")!();
		await pa;
		expect(h.notes.get("a.md")).toContain('data-linked-artifact-type="epic"');
		expect(h.notes.get("a.md")).not.toContain('"story"');
		expect(h.notes.get("b.md")).toContain('data-linked-artifact-type="story"');
		expect(h.notes.get("b.md")).not.toContain('"epic"');
	});

	it("F5: only the edited chip's wrapper changes; the rest of the note is byte-identical", async () => {
		const app = makeFakeApp({
			files: { "Work/Auth.md": `- [ ] ${EPIC} Login ^ep1\n` },
		});
		const other = linkChip("tpl-other", "Zed#^z", "story");
		const before = `# Title\n- [ ] ${EPIC} A ${other} tail ^t1\n- [ ] B ${linkChip(
			"tpl-aaa",
			"Old#^x"
		)} end  \r\n\n- [ ] C ${other}\n`;
		const h = harness(app, { "n.md": before }, "Old#^x", () => "Auth#^ep1");
		await edit(h, "n.md", "tpl-aaa");

		const after = h.notes.get("n.md")!;
		const oldWrapper = linkChip("tpl-aaa", "Old#^x");
		const at = before.indexOf(oldWrapper);
		const prefix = before.slice(0, at);
		const suffix = before.slice(at + oldWrapper.length);
		expect(after.startsWith(prefix)).toBe(true);
		expect(after.endsWith(suffix)).toBe(true);
		const middle = after.slice(prefix.length, after.length - suffix.length);
		expect(middle).toContain('data-linked-artifact-type="epic"');
		expect(middle.startsWith('<span data-template-wrapper="tpl-aaa"')).toBe(true);
		expect(middle.endsWith("</span>")).toBe(true);
	});

	it("cancelling the modal writes nothing and does no lookup", async () => {
		const app = makeFakeApp({ files: {} });
		const h = harness(
			app,
			{ "n.md": `${linkChip("tpl-aaa", "Old#^x")}\n` },
			"Old#^x",
			() => undefined
		);
		await edit(h, "n.md", "tpl-aaa");
		expect(h.writes).toEqual([]);
		expect(app.reads).toEqual([]);
	});
});

describe("insert path renders through the same awaited lookup", () => {
	it("renders the typed chip: wrapper attribute and the Epic emoji next to the link icon", async () => {
		const app = makeFakeApp({
			files: { "Work/Auth.md": `- [ ] ${EPIC} Login flow ^ep1\n` },
		});
		const html = await renderTemplateWithWorkflows(
			app,
			KEY,
			{ blockRef: "Auth#^ep1" },
			"Scratch/link-demo.md"
		);
		expect(html).toContain('data-linked-artifact-type="epic"');
		expect(html).toMatch(/>🔗[^<]+<\/a>/); // 🔗 plus the epic emoji
		expect(html).toContain('data-order-tag="metadata"');
	});

	it("unreadable target: plain 🔗, no type attribute, no rejection", async () => {
		const app = makeFakeApp({ files: {} });
		const html = await renderTemplateWithWorkflows(
			app,
			KEY,
			{ blockRef: "Work/Auth.md#^ep1" },
			""
		);
		expect(html).not.toContain("data-linked-artifact-type");
		expect(html).toContain(">🔗</a>");
	});

	it("a template without workflows renders as renderTemplateOnly does, with no reads", async () => {
		const app = makeFakeApp({ files: {} });
		const html = await renderTemplateWithWorkflows(
			app,
			"workflows.metadata.version",
			{ version: "1.2.3" },
			""
		);
		expect(html).toContain("1.2.3");
		expect(app.reads).toEqual([]);
	});
});
