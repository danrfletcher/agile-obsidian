import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");

const REMOVED_FOLDERS = [
	"agile-dashboard-view",
	"task-buttons",
	"task-tree-fold",
	"task-tree-builder",
	"task-snooze",
	"task-metadata-cleanup",
	"org-structure",
	"task-assignment",
	"task-assignment-cascade",
	"task-status-sequencer",
	"task-close-manager",
	"task-close-cascade",
	"task-filter",
];

function walk(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walk(p, out);
		else out.push(p);
	}
	return out;
}

const TEXT_EXT = /\.(ts|tsx|js|mjs|cjs|json|css|md)$/;
const files = walk(SRC).filter((f) => TEXT_EXT.test(f));

describe("removal guard (F1, F8)", () => {
	it("scans a non-trivial set of source files", () => {
		expect(files.length).toBeGreaterThan(20);
	});

	it.each(REMOVED_FOLDERS)("folder %s no longer exists", (name) => {
		expect(existsSync(join(SRC, "features", name))).toBe(false);
	});

	it("no removed folder name appears in any import or string under src/", () => {
		const re = new RegExp(REMOVED_FOLDERS.join("|"));
		const hits: string[] = [];
		for (const f of files) {
			const lines = readFileSync(f, "utf8").split("\n");
			lines.forEach((line, i) => {
				if (re.test(line)) hits.push(`${relative(ROOT, f)}:${i + 1}: ${line.trim()}`);
			});
		}
		expect(hits).toEqual([]);
	});

	it("agile-project-management is not mentioned anywhere under src/", () => {
		const hits = files.filter((f) =>
			readFileSync(f, "utf8").includes("agile-project-management")
		);
		expect(hits.map((f) => relative(ROOT, f))).toEqual([]);
	});

	it("the removed composition/platform/settings files are gone", () => {
		for (const rel of [
			"composition/wire/org-structure.ts",
			"composition/wire/task-flows.ts",
			"composition/register-styles.ts",
			"platform/obsidian/adapters/token-ops-adapter.ts",
			"settings/domain/selectors.ts",
			"settings/ui/modals",
			"settings/ui/presenters",
			"shared",
			"styles/custom-checkboxes",
		]) {
			expect(existsSync(join(SRC, rel)), rel).toBe(false);
		}
	});

	it("styles.css and src/**/*.css have no dashboard, snooze, org-structure or assignment selectors", () => {
		const css = [join(ROOT, "styles.css"), ...files.filter((f) => f.endsWith(".css"))];
		for (const f of css) {
			expect(readFileSync(f, "utf8"), relative(ROOT, f)).not.toMatch(
				/dashboard|snooze|org-structure|assignment/i
			);
		}
	});
});
