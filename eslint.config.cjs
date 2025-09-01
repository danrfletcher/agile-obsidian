// Flat ESLint config for ESLint v9+ (array form)
// Base config applies to all TypeScript files; subsequent entries act as glob-based overrides.

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
					// Allow a feature's index barrel to reach into that feature's internals
					{
						from: "src/features/*/index.*",
						allow: ["src/features/*/**"],
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
						"src/composition/**", // allow composition modules
					],
				},
			],

			// Restrict platform deep imports only; same-feature restrictions handled by boundaries above
			"no-restricted-imports": [
				"error",
				{ patterns: ["src/platform/**", "*/platform/**"] },
			],
		},
	},

	// Allow internal relative imports and other intra-feature imports for files inside features
	{
		files: ["src/features/**"],
		rules: {
			// Turn off the internal-modules rule inside feature folders so files can import siblings
			"import/no-internal-modules": "off",
		},
	},

	// Allow internal relative imports for the settings package (it's at src/settings)
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

	// Composition (wiring) is allowed to import feature public APIs only; enforce allow-list here
	{
		files: ["src/composition/**", "src/main.ts"],
		rules: {
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
						"src/composition/**",
					],
				},
			],
		},
	},
];
