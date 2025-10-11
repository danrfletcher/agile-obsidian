module.exports = [
	// Base config for all TypeScript files
	{
		ignores: ["node_modules/**", "main.js"],
		files: ["**/*.ts"],
		languageOptions: {
			parser: require("@typescript-eslint/parser"),
			parserOptions: { sourceType: "module" },
			globals: {
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
			},
		},

		plugins: {
			"@typescript-eslint": require("@typescript-eslint/eslint-plugin"),
			import: require("eslint-plugin-import"),
			boundaries: require("eslint-plugin-boundaries"),
		},

		settings: {
			"import/resolver": { typescript: {} },
			boundaries: {
				default: "disallow",
				rules: [
					// Allow shared package barrels (e.g. src/shared/identity/index.ts) to re-export internals
					{
						from: "src/shared/*/index.*",
						allow: ["src/shared/*/**"],
					},
					// Allow any file inside a feature to import that feature's internals
					{ from: "src/features/*/**", allow: ["src/features/*/**"] },
					// Allow platform index barrel to reach into that feature's internals
					{
						from: "src/platform/*/index.*",
						allow: ["src/platform/*/**"],
					},
					// Allow settings index barrel to reach into that feature's internals
					{
						from: "src/settings/*/index.*",
						allow: ["src/settings/*/**"],
					},
					{
						from: "src/**/domain/**",
						allow: [
							"src/**/domain/**",
							"src/**/infra/**",
							"src/composition/**",
						],
					},
					{
						from: "src/**/app/**",
						allow: [
							"src/**/app/**",
							"src/**/infra/**",
							"src/composition/**",
							"src/platform/**",
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

			// Prevent deep imports into feature folders (only allow feature root imports)
			"import/no-internal-modules": [
				"error",
				{
					allow: [
						"@features/*",
						"@features/*/index",
						"@composition/*",
						"@platform/*",
						"@styles/*",
						"@types/*",
						"src/features/*/**", // allow same-feature internal imports via absolute paths
						"src/composition/**", // allow composition modules (absolute)
					],
				},
			],

			// Restrict certain deep imports project-wide. Must import from the public package/barrel API
			"no-restricted-imports": [
				"error",
				{
					patterns: [
						"src/platform/**",
						"*/platform/**",
						"src/settings/**/domain/**",
						"src/settings/**/infra/**",
						"@settings/domain/**",
						"@settings/infra/**",
					],
				},
			],
		},
	},

	// Allow internal relative imports and other intra-feature imports for files inside features
	{
		files: ["src/features/**"],
		rules: {
			"import/no-internal-modules": "off",
		},
	},
	// Allow internal relative imports for the settings package
	{
		files: ["src/settings/**"],
		rules: {
			"import/no-internal-modules": "off",
		},
	},
	// Disable import/no-internal-modules for shared packages so barrels can re-export internals
	{
		files: ["src/shared/**"],
		rules: {
			"import/no-internal-modules": "off",
		},
	},
	// Disable import/no-internal-modules for platform packages so barrels can re-export internals
	{
		files: ["src/platform/**"],
		rules: {
			"import/no-internal-modules": "off",
		},
	},

	// Composition (wiring) is allowed to import its own internals.
	{
		files: ["src/composition/**", "src/main.ts"],
		rules: {
			"import/no-internal-modules": [
				"error",
				{
					allow: [
						"@features/*",
						"@features/*/index",
						"@composition/**", // allow deeper @composition/ui/*, @composition/wire/*, etc.
						"@platform/*",
						"@styles/*",
						"@types/*",
						"src/composition/**", // allow absolute path into composition
						"./**", // allow relative internal imports within composition (./wire/*)
						"../**", // allow relative parent within composition (../ui/*)
					],
				},
			],
		},
	},
];
