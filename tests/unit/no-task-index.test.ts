import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");

function walk(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walk(p, out);
		else out.push(p);
	}
	return out;
}

const files = walk(SRC);

describe("F2: no vault-wide task index", () => {
	it("scans a non-trivial set of source files", () => {
		expect(files.length).toBeGreaterThan(20);
	});

	it("the task-index feature and its wiring are deleted", () => {
		expect(existsSync(join(SRC, "features", "task-index"))).toBe(false);
		expect(existsSync(join(SRC, "composition", "wire", "task-index.ts"))).toBe(false);
	});

	it("no src file mentions the index, its service, its ports or its lookups", () => {
		const re = /task-index|TaskIndex|taskIndexService|getTaskByBlockRef|getItemAtCursor/;
		const hits: string[] = [];
		for (const f of files) {
			readFileSync(f, "utf8")
				.split("\n")
				.forEach((line, i) => {
					if (re.test(line)) hits.push(`${relative(ROOT, f)}:${i + 1}: ${line.trim()}`);
				});
		}
		expect(hits).toEqual([]);
	});

	it("no src file imports from task-index (by alias or relative path)", () => {
		const importRe = /(?:from|import)\s*\(?\s*["'][^"']*task-index[^"']*["']/;
		const hits = files.filter(
			(f) => /\.(ts|tsx|js|mjs)$/.test(f) && importRe.test(readFileSync(f, "utf8"))
		);
		expect(hits.map((f) => relative(ROOT, f))).toEqual([]);
	});

	it("tsconfig and eslint config have no task-index alias or boundary", () => {
		for (const rel of ["tsconfig.json", "eslint.config.mjs", "vitest.config.ts", "esbuild.config.mjs"]) {
			expect(readFileSync(join(ROOT, rel), "utf8"), rel).not.toMatch(/task-index/);
		}
	});

	it("templating-engine imports nothing from task-index or task-filter", () => {
		const engine = files.filter((f) =>
			f.includes(join("features", "templating-engine"))
		);
		expect(engine.length).toBeGreaterThan(5);
		for (const f of engine) {
			expect(readFileSync(f, "utf8"), relative(ROOT, f)).not.toMatch(
				/@features\/task-(index|filter)/
			);
		}
	});

	it("plugin load makes no vault scan: main, container and every wire/* module avoid getMarkdownFiles and vault reads", () => {
		const atLoad = files.filter(
			(f) =>
				f === join(SRC, "main.ts") ||
				f === join(SRC, "composition", "container.ts") ||
				f === join(SRC, "composition", "register-commands.ts") ||
				f.startsWith(join(SRC, "composition", "wire"))
		);
		expect(atLoad.length).toBeGreaterThan(3);
		for (const f of atLoad) {
			expect(readFileSync(f, "utf8"), relative(ROOT, f)).not.toMatch(
				/getMarkdownFiles|vault\.(read|cachedRead)\(/
			);
		}
	});

	it("the blockSelect candidate list is built lazily, from the field's focus handler", () => {
		const src = readFileSync(
			join(SRC, "features", "templating-params-editor", "ui", "modals", "template-schema-modal.ts"),
			"utf8"
		);
		const calls = src.match(/ensureIndex\(/g) ?? [];
		// one definition + one call inside ensureIndexReady (invoked only from the focus handler)
		expect(calls.length).toBe(2);
		expect(src).toMatch(/inputEl\.addEventListener\("focus"[\s\S]*?ensureIndexReady\(\)/);
	});
});
