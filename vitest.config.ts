import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
	resolve: {
		alias: [
			{ find: /^obsidian$/, replacement: r("./tests/stubs/obsidian.ts") },
			{ find: /^@settings$/, replacement: r("./src/settings/index.ts") },
			{ find: /^@settings\//, replacement: r("./src/settings/") },
			{ find: /^@features\//, replacement: r("./src/features/") },
			{ find: /^@composition\//, replacement: r("./src/composition/") },
			{ find: /^@platform\//, replacement: r("./src/platform/") },
			{ find: /^@utils$/, replacement: r("./src/utils/index.ts") },
			{ find: /^src\//, replacement: r("./src/") },
		],
	},
	test: {
		include: ["tests/**/*.test.ts"],
		environment: "node",
	},
});
