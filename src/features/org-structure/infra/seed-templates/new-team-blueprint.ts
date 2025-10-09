/**
 * Blueprint for new team folder structure and sample content.
 * This is used for both regular teams (empty content) and the Sample Team (pre-populated content).
 *
 * Rules applied by createTeamResources/materializeBlueprint:
 * - "Docs" folder is created as-is.
 * - "Initiatives" folder is renamed to include slug.
 * - Markdown files inside "Initiatives" are renamed to include slug, and a few known stems
 *   ("Completed", "Initiatives", "Priorities") use explicit naming helpers.
 */

export type BlueprintNode =
	| { type: "folder"; name: string; children?: BlueprintNode[] }
	| { type: "file"; name: string; content?: string };

export const NEW_TEAM_BLUEPRINT: BlueprintNode[] = [
	{
		type: "folder",
		name: "Docs",
		children: [
			// Add any docs that should exist for all teams by default.
			// Example starter doc (optional):
			// { type: "file", name: "README.md", content: "# Team Docs\n\nWelcome to your team Docs." }
		],
	},
	{
		type: "folder",
		name: "Initiatives",
		children: [
			{
				type: "file",
				name: "Initiatives.md",
				content: `# Initiatives

- [ ] Draft initial roadmap for the next quarter
- [ ] Identify key stakeholders and align on priorities
- [ ] Define success metrics

> Tip: Use checkboxes to track progress on initiatives.
`,
			},
			{
				type: "file",
				name: "Priorities.md",
				content: `# Priorities

1. Stabilize onboarding flow
2. Improve dashboard load times
3. Standardize coding guidelines

> Reorder as needed to reflect current focus.
`,
			},
			{
				type: "file",
				name: "Completed.md",
				content: `# Completed

- Initial team setup
- Defined meeting cadence
- Established communication channels
`,
			},
			// You can add more files here, e.g., OKRs.md — they will be auto-renamed with slugs:
			// {
			//   type: "file",
			//   name: "OKRs.md",
			//   content: "# OKRs\n\nObjective: Deliver high-quality releases faster.\n- Key Result 1: ...\n- Key Result 2: ...\n"
			// },
		],
	},
];
