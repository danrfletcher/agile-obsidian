import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import boundariesPlugin from "eslint-plugin-boundaries";
import obsidianmd from "eslint-plugin-obsidianmd";
import dependPlugin from "eslint-plugin-depend";
import { defineConfig } from "eslint/config";

export default defineConfig([
  // 0. Global ignores
  {
    ignores: ["node_modules/**", "main.js"],
  },

  // 1. Obsidian recommended rules
  ...obsidianmd.configs.recommended,

  // 2. Project-specific TS config
  {
    files: ["**/*.ts"],

    languageOptions: {
      parser: tsParser,
      parserOptions: {
        sourceType: "module",
        project: "./tsconfig.json",
      },
      globals: {
        // Node-style globals you're already using
        process: "readonly",
        module: "readonly",
        require: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",

        // Browser-like globals (replacement for env: { browser: true })
        window: "readonly",
        document: "readonly",
        console: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        navigator: "readonly",
        location: "readonly",
        history: "readonly",
        fetch: "readonly",
        Request: "readonly",
        Response: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        HTMLElement: "readonly",
        Event: "readonly",
      },
    },

    plugins: {
      "@typescript-eslint": tsPlugin,
      boundaries: boundariesPlugin,
      depend: dependPlugin,
      // "obsidianmd" already enabled via configs.recommended
    },

    settings: {
      boundaries: {
        // Global default: disallow cross-boundary imports unless a rule allows it
        default: "disallow",
        rules: [
          // Shared: only index can be imported from outside; index can reach inside its own module
          {
            from: "src/shared/*/index.*",
            allow: ["src/shared/*/**"],
          },
          // Features: feature code can reach inside its own tree
          {
            from: "src/features/*/**",
            allow: ["src/features/*/**"],
          },
          // Platform: only index can be imported; index can reach inside its own tree
          {
            from: "src/platform/*/index.*",
            allow: ["src/platform/*/**"],
          },
          // Settings: only index can be imported; index can reach inside its own tree
          {
            from: "src/settings/*/index.*",
            allow: ["src/settings/*/**"],
          },
          // Domain layer rules
          {
            from: "src/**/domain/**",
            allow: [
              "src/**/domain/**",
              "src/**/infra/**",
              "src/composition/**",
            ],
          },
          // App layer rules
          {
            from: "src/**/app/**",
            allow: [
              "src/**/app/**",
              "src/**/infra/**",
              "src/composition/**",
              "src/platform/**",
            ],
          },
          // Composition: allowed to orchestrate across features/platform/settings
          {
            from: "src/composition/**",
            allow: [
              "src/features/**",
              "src/platform/**",
              "src/settings/**",
              "src/shared/**",
              "src/composition/**",
            ],
          },
          // Main entry: same orchestration power as composition
          {
            from: "src/main.*",
            allow: [
              "src/features/**",
              "src/platform/**",
              "src/settings/**",
              "src/shared/**",
              "src/composition/**",
            ],
          },
        ],
      },
    },

    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["error", { args: "none" }],
      "@typescript-eslint/ban-ts-comment": "off",
      "no-prototype-builtins": "off",
      "@typescript-eslint/no-empty-function": "off",

      // You can leave this off globally if you want
      "depend/ban-dependencies": "off",

      "no-restricted-imports": [
        "error",
        {
          patterns: [
            // Block importing platform internals directly from arbitrary places.
            // Only entrypoints / allowed layers via boundaries rules should touch platform.
            "src/platform/**",

            // Block importing settings domain/infra directly
            "src/settings/**/domain/**",
            "src/settings/**/infra/**",
            "@settings/domain/**",
            "@settings/infra/**",
          ],
        },
      ],
    },
  },

  // 3. Folder-specific overrides

  {
    files: ["src/features/**"],
    rules: {
      // additional feature-specific rules could go here
    },
  },
  {
    files: ["src/settings/**"],
    rules: {
      // additional settings-specific rules could go here
    },
  },
  {
    files: ["src/shared/**"],
    rules: {
      // additional shared-specific rules could go here
    },
  },
  {
    files: ["src/platform/**"],
    rules: {
      // additional platform-specific rules could go here
    },
  },
  {
    files: ["src/composition/**", "src/main.ts"],
    rules: {
      // add them later.
    },
  },

  // 3.5. Turn off depend/ban-dependencies specifically for package.json
  {
    files: ["package.json"],
    rules: {
      "depend/ban-dependencies": "off",
    },
  },

  // 4. Safety net for JS files: don't run TS typed rule there
  {
    files: ["**/*.js"],
    rules: {
      "@typescript-eslint/no-deprecated": "off",
    },
  },
]);