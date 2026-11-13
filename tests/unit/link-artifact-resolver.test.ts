import { describe, expect, it } from "vitest";
import { presetTemplates } from "@features/templating-engine/domain/presets";
import {
	findLineByBlockId,
	lineToTaskLike,
	parseBlockRef,
	resolveLinkedArtifactType,
} from "@features/templating-engine/domain/link-artifact-resolver";
import { makeFakeApp } from "../helpers/fake-app";

type Def = {
	id: string;
	orderTag?: string;
	render: (params?: Record<string, unknown>) => string;
};

const byId = new Map<string, Def>();
for (const defs of Object.values(presetTemplates)) {
	for (const def of Object.values(defs as Record<string, Def>)) {
		byId.set(def.id, def);
	}
}

const SAMPLE = { title: "Sample title", details: "Sample details" };
const STORY = {
	title: "Sample title",
	persona: "Registered user",
	desire: "log in to the site",
	outcome: "access my dashboard",
};

const chipFor = (id: string): string => {
	const def = byId.get(id);
	if (!def) throw new Error(`no preset ${id}`);
	return def.render(id === "agile.userStory" ? STORY : SAMPLE);
};

// Written out by hand (not derived from getAgileArtifactType) so a change to the
// inference is caught. These are the types 5a90994's getAgileArtifactType gives.
const EXPECTED_ARTIFACT_TYPES: Record<string, string> = {
	"agile.initiative": "initiative",
	"agile.epic": "epic",
	"agile.feature": "feature",
	"agile.product": "product",
	"agile.userStory": "story",
	"agile.acceptanceCriteria": "task",
	"agile.recurringRes": "recurring-responsibility",
	"agile.okr": "okr",
	"agile.personalLearningInitiative": "initiative",
	"agile.personalLearningEpic": "epic",
};

describe("parseBlockRef", () => {
	it.each([
		["Work/Auth.md#^ep1", "Work/Auth.md", "ep1"],
		["Work/Auth#^ep1", "Work/Auth", "ep1"],
		["Auth#^ep1", "Auth", "ep1"],
		["#^ep1", "", "ep1"],
		["  Auth#^ep1  ", "Auth", "ep1"],
		["Auth", "Auth", ""],
		["Auth#^", "Auth", ""],
		["", "", ""],
		["   ", "", ""],
		["Ideas/Café plan.md#^ab12cd", "Ideas/Café plan.md", "ab12cd"],
	])("%j -> file %j, id %j", (raw, filePart, blockId) => {
		expect(parseBlockRef(raw)).toEqual({ filePart, blockId });
	});

	it("tolerates non-string input", () => {
		expect(parseBlockRef(undefined)).toEqual({ filePart: "", blockId: "" });
		expect(parseBlockRef(42)).toEqual({ filePart: "", blockId: "" });
	});
});

describe("findLineByBlockId", () => {
	it("finds the line with the id at the line end", () => {
		expect(findLineByBlockId("a\n- [ ] Login ^ep1\nb", "ep1")).toBe(
			"- [ ] Login ^ep1"
		);
	});
	it("tolerates trailing spaces", () => {
		expect(findLineByBlockId("- [ ] Login ^ep1   \nx", "ep1")).toBe(
			"- [ ] Login ^ep1   "
		);
	});
	it("tolerates CRLF", () => {
		const line = findLineByBlockId("a\r\n- [ ] Login ^ep1\r\nb\r\n", "ep1");
		expect(line).toBe("- [ ] Login ^ep1");
	});
	it("does not match an id that is only a suffix of a longer id or word", () => {
		expect(findLineByBlockId("- [ ] x ^ep10", "ep1")).toBeUndefined();
		expect(findLineByBlockId("- [ ] x^ep1", "ep1")).toBeUndefined();
	});
	it("does not match an id in the middle of a line", () => {
		expect(findLineByBlockId("- [ ] x ^ep1 more", "ep1")).toBeUndefined();
	});
	it("returns undefined for a missing or empty id", () => {
		expect(findLineByBlockId("- [ ] x ^ep1", "zz")).toBeUndefined();
		expect(findLineByBlockId("- [ ] x ^ep1", "")).toBeUndefined();
	});
	it("matches a line that is only the block id", () => {
		expect(findLineByBlockId("para\n^only", "only")).toBe("^only");
	});
});

describe("lineToTaskLike", () => {
	it("strips list marker, checkbox and block id and keeps the status", () => {
		expect(lineToTaskLike("  - [x] Login flow ^ep1")).toEqual({
			text: "Login flow",
			status: "x",
		});
	});
	it("has no status for plain list items and paragraphs", () => {
		expect(lineToTaskLike("- Login ^a")).toEqual({ text: "Login" });
		expect(lineToTaskLike("Some paragraph ^a")).toEqual({
			text: "Some paragraph",
		});
	});
	it("handles numbered lists", () => {
		expect(lineToTaskLike("1. [ ] Do it ^a")).toEqual({
			text: "Do it",
			status: " ",
		});
	});
});

describe("resolveLinkedArtifactType: type per artefact chip", () => {
	it("covers every artifact-item-type preset", () => {
		const ids = [...byId.values()]
			.filter((d) => d.orderTag === "artifact-item-type")
			.map((d) => d.id)
			.sort();
		expect(ids).toEqual(Object.keys(EXPECTED_ARTIFACT_TYPES).sort());
	});

	it.each(Object.entries(EXPECTED_ARTIFACT_TYPES))(
		"%s chip -> %s",
		async (id, expected) => {
			const app = makeFakeApp({
				files: { "Work/Auth.md": `- [ ] ${chipFor(id)} ^ep1\n` },
			});
			expect(
				await resolveLinkedArtifactType(app, "Work/Auth.md#^ep1", "Scratch/n.md")
			).toBe(expected);
		}
	);

	it("a line with an Epic chip gives epic and a Story chip gives story", async () => {
		const app = makeFakeApp({
			files: {
				"Work/Auth.md": `- [ ] ${chipFor("agile.epic")} Login ^ep1\n- [ ] ${chipFor(
					"agile.userStory"
				)} Log in ^st1\n`,
			},
		});
		expect(await resolveLinkedArtifactType(app, "Work/Auth#^ep1", "")).toBe("epic");
		expect(await resolveLinkedArtifactType(app, "Work/Auth#^st1", "")).toBe("story");
	});
});

describe("resolveLinkedArtifactType: blockRef forms", () => {
	const epicLine = `- [ ] ${chipFor("agile.epic")} Login flow ^ep1\n`;
	const files = { "Work/Auth.md": epicLine };

	it("path with .md", async () => {
		const app = makeFakeApp({ files });
		expect(await resolveLinkedArtifactType(app, "Work/Auth.md#^ep1", "x.md")).toBe("epic");
		expect(app.linkLookups).toEqual([]);
	});

	it("path without .md gets .md added", async () => {
		const app = makeFakeApp({ files });
		expect(await resolveLinkedArtifactType(app, "Work/Auth#^ep1", "x.md")).toBe("epic");
		expect(app.reads).toEqual(["Work/Auth.md"]);
	});

	it("link-text / basename form is resolved through getFirstLinkpathDest with the source path", async () => {
		const app = makeFakeApp({ files });
		expect(await resolveLinkedArtifactType(app, "Auth#^ep1", "Scratch/link-demo.md")).toBe("epic");
		expect(app.linkLookups).toEqual([["Auth", "Scratch/link-demo.md"]]);
		expect(app.reads).toEqual(["Work/Auth.md"]);
	});

	it("a bare #^id has no file part and resolves to no type without reading anything", async () => {
		const app = makeFakeApp({ files });
		expect(await resolveLinkedArtifactType(app, "#^ep1", "x.md")).toBeUndefined();
		expect(app.reads).toEqual([]);
		expect(app.linkLookups).toEqual([]);
	});

	it("Unicode and spaces in the path", async () => {
		const app = makeFakeApp({
			files: { "Ideas/Café plan.md": `- [ ] ${chipFor("agile.initiative")} Plan ^ab12cd\n` },
		});
		expect(await resolveLinkedArtifactType(app, "Ideas/Café plan.md#^ab12cd", "")).toBe("initiative");
		expect(await resolveLinkedArtifactType(app, "Ideas/Café plan#^ab12cd", "")).toBe("initiative");
		expect(await resolveLinkedArtifactType(app, "Café plan#^ab12cd", "")).toBe("initiative");
	});

	it("reads only the target file (no vault scan)", async () => {
		const app = makeFakeApp({
			files: { ...files, "Other.md": "- [ ] x ^zz\n", "More.md": "- [ ] y\n" },
		});
		await resolveLinkedArtifactType(app, "Work/Auth.md#^ep1", "");
		expect(app.reads).toEqual(["Work/Auth.md"]);
	});
});

describe("resolveLinkedArtifactType: no type, never throws (E10)", () => {
	const epicLine = `- [ ] ${chipFor("agile.epic")} Login flow ^ep1\n`;

	it("missing file (renamed or deleted)", async () => {
		const app = makeFakeApp({ files: { "Work/Auth-old.md": epicLine } });
		await expect(
			resolveLinkedArtifactType(app, "Work/Auth.md#^ep1", "x.md")
		).resolves.toBeUndefined();
		await expect(
			resolveLinkedArtifactType(app, "Auth#^ep1", "x.md")
		).resolves.toBeUndefined();
	});

	it("file deleted between two lookups", async () => {
		const app = makeFakeApp({ files: { "Work/Auth.md": epicLine } });
		expect(await resolveLinkedArtifactType(app, "Work/Auth.md#^ep1", "")).toBe("epic");
		app.remove("Work/Auth.md");
		expect(await resolveLinkedArtifactType(app, "Work/Auth.md#^ep1", "")).toBeUndefined();
	});

	it("block id not present in an existing file", async () => {
		const app = makeFakeApp({ files: { "Work/Auth.md": epicLine } });
		expect(await resolveLinkedArtifactType(app, "Work/Auth.md#^nope", "")).toBeUndefined();
	});

	it("target line without a template chip", async () => {
		const app = makeFakeApp({ files: { "Scratch/a.md": "- [ ] Wire SSO ^p1\n- plain ^p2\n" } });
		expect(await resolveLinkedArtifactType(app, "Scratch/a.md#^p1", "")).toBeUndefined();
		expect(await resolveLinkedArtifactType(app, "Scratch/a.md#^p2", "")).toBeUndefined();
	});

	it("target line with only non-artefact chips", async () => {
		const pr = byId.get("workflows.metadata.pr")!.render({ href: "https://x" });
		const version = byId.get("workflows.metadata.version")!.render({ version: "1.0.0" });
		const app = makeFakeApp({
			files: { "Scratch/a.md": `- [ ] ${pr} ${version} Ship ^p1\n` },
		});
		expect(await resolveLinkedArtifactType(app, "Scratch/a.md#^p1", "")).toBeUndefined();
	});

	it("target line with only Kano or MoSCoW priority chips", async () => {
		const priorityIds = [...byId.keys()].filter(
			(id) => id.startsWith("prio.kano.") || id.startsWith("prio.moscow.")
		);
		// Guard: both families are actually covered.
		expect(priorityIds.some((id) => id.startsWith("prio.kano."))).toBe(true);
		expect(priorityIds.some((id) => id.startsWith("prio.moscow."))).toBe(true);
		for (const id of priorityIds) {
			const app = makeFakeApp({
				files: { "Scratch/a.md": `- [ ] ${chipFor(id)} Rank me ^p1\n` },
			});
			expect(
				await resolveLinkedArtifactType(app, "Scratch/a.md#^p1", ""),
				id
			).toBeUndefined();
		}
	});

	it("non-markdown target", async () => {
		const app = makeFakeApp({ files: { "Assets/pic.png": "- [ ] x ^a\n" } });
		expect(await resolveLinkedArtifactType(app, "Assets/pic.png#^a", "")).toBeUndefined();
		expect(app.reads).toEqual([]);
	});

	it("folder target", async () => {
		const app = makeFakeApp({ files: {}, folders: ["Work", "Work/Auth.md"] });
		expect(await resolveLinkedArtifactType(app, "Work#^a", "")).toBeUndefined();
		expect(await resolveLinkedArtifactType(app, "Work/Auth.md#^a", "")).toBeUndefined();
		expect(app.reads).toEqual([]);
	});

	it("cachedRead rejects", async () => {
		const app = makeFakeApp({
			files: { "Work/Auth.md": epicLine },
			failRead: ["Work/Auth.md"],
		});
		await expect(
			resolveLinkedArtifactType(app, "Work/Auth.md#^ep1", "")
		).resolves.toBeUndefined();
	});

	it("a throwing vault resolves to no type", async () => {
		const app = makeFakeApp({ files: {} });
		app.vault.getAbstractFileByPath = () => {
			throw new Error("boom");
		};
		await expect(
			resolveLinkedArtifactType(app, "Work/Auth.md#^ep1", "")
		).resolves.toBeUndefined();
	});

	it.each(["", "   ", "Auth", "Auth#^"])("blockRef %j gives no type", async (ref) => {
		const app = makeFakeApp({ files: { "Auth.md": epicLine } });
		expect(await resolveLinkedArtifactType(app, ref, "")).toBeUndefined();
	});
});

describe("F3: the target text is only read, never evaluated", () => {
	it("a target line full of script-like text is just text", async () => {
		const evil =
			"- [ ] <script>globalThis.__pwned = true</script> ${process.exit(1)} {{x}} ^ep1\n";
		const app = makeFakeApp({ files: { "Work/Auth.md": evil } });
		expect(await resolveLinkedArtifactType(app, "Work/Auth.md#^ep1", "")).toBeUndefined();
		expect((globalThis as Record<string, unknown>).__pwned).toBeUndefined();
	});
});
