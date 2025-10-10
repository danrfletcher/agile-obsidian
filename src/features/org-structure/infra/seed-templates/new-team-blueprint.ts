/**
 * Blueprint for new team folder structure and sample content.
 * This is used for both regular teams (empty content) and the Sample Team (pre-populated content).
 *
 * Rules applied by createTeamResources/materializeBlueprint:
 * - By default, all folders and files are renamed to include the slug.
 * - You can disable slug renaming per node with `renameWithSlug: false`. This setting
 *   is inherited by children unless they explicitly set their own flag.
 * - "Initiatives" folder and its known files ("Completed", "Initiatives", "Priorities")
 *   use explicit naming helpers to preserve exact casing and conventions.
 *
 * Content source:
 * - We import sample markdown content from collocated files so it’s easy to edit.
 * - Ensure your bundler (esbuild) has a loader configured for .md: loader: { ".md": "text" }.
 */

import INITIATIVES_MD from "./content/new-team/Initiatives.md";
import PRIORITIES_MD from "./content/new-team/Priorities.md";
import COMPLETED_MD from "./content/new-team/Completed.md";
import OKRS_MD from "./content/new-team/OKRs.md";

export type BlueprintNode =
	| {
			type: "folder";
			name: string;
			children?: BlueprintNode[];
			/**
			 * If true (default) this node (and, via inheritance, its children) are renamed to include the slug.
			 * If false, no slug renaming is applied to this node; children inherit this setting unless overridden.
			 */
			renameWithSlug?: boolean;
	  }
	| {
			type: "file";
			name: string;
			content?: string;
			/**
			 * If true (default) this file is renamed to include the slug; if false, keep the original name.
			 */
			renameWithSlug?: boolean;
	  };

export const NEW_TEAM_BLUEPRINT: BlueprintNode[] = [
	{
		type: "folder",
		name: "Docs",
		renameWithSlug: false, // Do not add slug to "Docs" (and its descendants)
		children: [
			// Optionally add docs for all teams:
			// { type: "file", name: "README.md", content: README_MD },
		],
	},
	{
		type: "folder",
		name: "Initiatives",
		// renameWithSlug omitted -> defaults to true
		children: [
			{
				type: "file",
				name: "Initiatives.md",
				content: INITIATIVES_MD,
			},
			{
				type: "file",
				name: "Priorities.md",
				content: PRIORITIES_MD,
			},
			{
				type: "file",
				name: "Completed.md",
				content: COMPLETED_MD,
			},
			{
				type: "file",
				name: "OKRs.md",
				content: OKRS_MD,
			},
		],
	},
];
