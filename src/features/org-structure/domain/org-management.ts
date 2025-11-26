import { App } from "obsidian";
import {
	buildResourceFileName,
	buildResourceFolderName,
	getBaseCodeFromSlug,
	buildTeamSlug,
	buildOrgChildSlug,
	parseTeamFolderName,
	getPathIdFromSlug,
} from "@features/org-structure/domain/org-slugs";
import {
	basename,
	dirname,
	ensureFolder,
	joinPath,
	safeRename,
} from "@platform/obsidian";
import { TeamInfo } from "./org-types";
import { slugifyName, TEAM_CODE_RE } from "@shared/identity";
import {
	NEW_TEAM_BLUEPRINT,
	type BlueprintNode,
} from "../infra/seed-templates/new-team-blueprint";

/**
 * Create a team folder and seed its resources from the blueprint.
 * If seedWithSampleData is true, markdown files created from the blueprint
 * will include the provided sample content; otherwise they will be empty.
 */
export async function createTeamResources(
	app: App,
	teamName: string,
	parentPath: string,
	teamSlug: string,
	resourcePathIdOverride?: string | null,
	seedWithSampleData: boolean = false
): Promise<{ info: { name: string; slug: string; rootPath: string } }> {
	const vault = app.vault;

	const code = getBaseCodeFromSlug(teamSlug);
	if (!code) throw new Error("Invalid team slug; unable to derive code");

	const inferredPathId = inferPathIdFromTeamSlug(teamName, teamSlug);
	const effectivePathId = resourcePathIdOverride ?? inferredPathId;
	const baseNameSlug = slugifyName(teamName);
	const canonicalPathId =
		effectivePathId && baseNameSlug.endsWith(`-${effectivePathId}`)
			? null
			: effectivePathId;
	const canonicalSlug = buildTeamSlug(teamName, code, canonicalPathId);

	// Create the team root folder: "<Name> (<canonicalSlug>)"
	const teamFolderName = `${teamName} (${canonicalSlug})`;
	const normalizedParent = (parentPath || "").replace(/\/+$/g, "");
	const teamRoot = normalizedParent
		? `${normalizedParent}/${teamFolderName}`
		: teamFolderName;
	await ensureFolder(vault, teamRoot);

	// Walk the blueprint and materialize it under teamRoot
	await materializeBlueprint({
		app,
		targetRoot: teamRoot,
		code,
		pathId: effectivePathId ?? null,
		seedWithSampleData,
	});

	return {
		info: { name: teamName, slug: canonicalSlug, rootPath: teamRoot },
	};
}

interface Organization {
	name: string;
	slug: string;
	rootPath: string; // e.g., "Organizations/Acme (acme-xyz)"
	teams: string[]; // team slugs included
}

/**
 * Create an organization structure from a selected team.
 * - Renames the existing team folder (if needed) to <OrgName> (<org-slug>)
 * - Ensures a "Teams" subfolder exists within the org root
 * - Creates child teams in-place inside "Teams" using the same logic as the "Add Team" flow
 * - Does NOT wrap the team in a new parent folder
 */
export async function createOrganizationFromTeam(opts: {
	app: App; // changed from vault: Vault
	orgName: string;
	orgSlug: string;
	organizationsRoot?: string; // unused here; org remains at the current location
	team: TeamInfo;
	suffixes?: string[]; // optional team suffixes to create immediately
}): Promise<Organization> {
	const { app, orgName, orgSlug, team, suffixes = [] } = opts;
	const vault = app.vault;

	// Validate team source
	if (!team.rootPath) throw new Error("Original team folder not found");

	const parentDir = dirname(team.rootPath);
	const currentFolderName = basename(team.rootPath);

	// Determine the stable 6-char code from current slug or provided orgSlug
	const parsed = parseTeamFolderName(currentFolderName);
	let code: string | null = parsed ? getBaseCodeFromSlug(parsed.slug) : null;
	if (!code) code = getBaseCodeFromSlug(orgSlug);
	if (!code)
		throw new Error("Could not determine team code for organization");

	// Build the desired org slug from the desired org name and existing code
	const desiredSlug = buildTeamSlug(orgName, code);
	const desiredFolderName = `${orgName} (${desiredSlug})`;
	const newRootPath = joinPath(parentDir, desiredFolderName);

	// Rename current team folder in-place to become the organization root (if needed)
	if (newRootPath !== team.rootPath) {
		await safeRename(vault, team.rootPath, newRootPath);
	}

	// Ensure "Teams" subfolder exists within the organization
	const teamsDir = joinPath(newRootPath, "Teams");
	await ensureFolder(vault, teamsDir);

	// Optionally create child teams inside the org's Teams folder
	const createdTeamSlugs: string[] = [];

	if (suffixes.length > 0) {
		// Collect used pathIds from existing children to avoid collisions
		const usedPathIds = new Set<string>();
		try {
			const list = await vault.adapter.list(teamsDir);
			const folders: string[] = Array.isArray(list?.folders)
				? list.folders
				: [];
			for (const full of folders) {
				const name = full.split("/").filter(Boolean).pop()!;
				const p = parseTeamFolderName(name);
				if (p) {
					const base = slugifyName(p.name);
					const pid = getPathIdFromSlug(p.slug, base);
					if (pid) usedPathIds.add(pid);
				}
			}
		} catch {
			// listing failed; proceed with empty set
		}

		for (let i = 0; i < suffixes.length; i++) {
			const rawSuffix = (suffixes[i] ?? "").trim();
			const displaySuffix = rawSuffix || `${i + 1}`;

			// Prefer numeric or slugified suffix as pathId; ensure uniqueness
			const baseCandidate = slugifyName(displaySuffix) || `${i + 1}`;
			let pid = baseCandidate;
			let n = 1;
			while (usedPathIds.has(pid)) {
				n++;
				pid = `${baseCandidate}-${n}`;
			}
			usedPathIds.add(pid);

			// Child alias and slug based on org base code + pathId
			const childName = `${orgName} ${displaySuffix}`;
			const childSlug = buildOrgChildSlug(orgName, code, pid);

			// Reuse the exact team creation flow as "Add Team"
			const parentPathForChild = teamsDir;
			const { info } = await createTeamResources(
				app,
				childName,
				parentPathForChild,
				childSlug,
				pid,
				/* seedWithSampleData */ false
			);

			createdTeamSlugs.push(info.slug);
		}
	}

	return {
		name: orgName,
		slug: desiredSlug,
		rootPath: newRootPath,
		teams: createdTeamSlugs,
	};
}

/**
 * Add teams to an existing organization (without restructuring).
 * Creates Teams/<OrgName Suffix> (...) for each suffix, seeding Projects/Initiatives structure.
 * This function preserves prior behavior for org child teams.
 */
export async function addTeamsToExistingOrganization(
	app: App,
	org: TeamInfo,
	orgName: string,
	suffixes: string[]
): Promise<void> {
	const segs = org.rootPath.split("/").filter(Boolean);
	const folderName = segs[segs.length - 1];
	const parsed = parseTeamFolderName(folderName);
	if (!parsed) throw new Error("Organization folder has no slug.");
	const slug = parsed.slug;
	const code = getBaseCodeFromSlug(slug);
	if (!code) throw new Error("Organization folder has no code.");

	const teamsDir = `${org.rootPath}/Teams`;
	if (!(await app.vault.adapter.exists(teamsDir))) {
		await app.vault.createFolder(teamsDir);
	}

	// Collect used pathIds from existing children to avoid collisions
	const usedPathIds = new Set<string>();
	try {
		const list = await app.vault.adapter.list(teamsDir);
		const folders: string[] = Array.isArray(list?.folders)
			? list.folders
			: [];
		for (const full of folders) {
			const name = full.split("/").filter(Boolean).pop()!;
			const p = parseTeamFolderName(name);
			if (p) {
				const base = slugifyName(orgName);
				const pid = getPathIdFromSlug(p.slug, base);
				if (pid) usedPathIds.add(pid);
			}
		}
	} catch {
		// listing failed; proceed with empty set
	}

	for (let i = 0; i < suffixes.length; i++) {
		const rawSuffix = (suffixes[i] ?? "").trim();
		const displaySuffix = rawSuffix || `${i + 1}`;
		const baseCandidate = slugifyName(displaySuffix) || `${i + 1}`;
		let pathId = baseCandidate;
		let n = 1;
		while (usedPathIds.has(pathId)) {
			n++;
			pathId = `${baseCandidate}-${n}`;
		}
		usedPathIds.add(pathId);

		const name = `${orgName} ${displaySuffix}`;
		const childPathId = pathId;
		const childSlug = buildOrgChildSlug(orgName, code, childPathId);
		const folder = `${teamsDir}/${name} (${childSlug})`;

		if (!(await app.vault.adapter.exists(folder))) {
			await app.vault.createFolder(folder);
		}

		// Maintain existing Projects/Initiatives structure for this org flow.
		const docs = `${folder}/Docs`;
		if (!(await app.vault.adapter.exists(docs))) {
			await app.vault.createFolder(docs);
		}

		const projects = `${folder}/Projects`;
		if (!(await app.vault.adapter.exists(projects))) {
			await app.vault.createFolder(projects);
		}
		const initDirName = buildResourceFolderName(
			"initiatives",
			code,
			pathId
		);
		const initDir = `${projects}/${initDirName}`;
		if (!(await app.vault.adapter.exists(initDir))) {
			await app.vault.createFolder(initDir);
		}
		const completedFile = `${initDir}/${buildResourceFileName(
			"completed",
			code,
			pathId
		)}`;
		const initiativesFile = `${initDir}/${buildResourceFileName(
			"initiatives",
			code,
			pathId
		)}`;
		const prioritiesFile = `${initDir}/${buildResourceFileName(
			"priorities",
			code,
			pathId
		)}`;
		if (!(await app.vault.adapter.exists(completedFile)))
			await app.vault.create(completedFile, "");
		if (!(await app.vault.adapter.exists(initiativesFile)))
			await app.vault.create(initiativesFile, "");
		if (!(await app.vault.adapter.exists(prioritiesFile)))
			await app.vault.create(prioritiesFile, "");
	}
}

/**
 * Create subteams under an existing team.
 * Produces Teams/<OrgName Suffix> (...) under the parent, without a pathId in the slug; resources also omit pathId.
 * This mirrors the organization child creation flow and reuses createTeamResources.
 */
export async function createSubteams(
	app: App,
	parentTeam: TeamInfo,
	suffixes: string[]
): Promise<void> {
	const vault = app.vault;

	const parentSegs = parentTeam.rootPath.split("/").filter(Boolean);
	const parentFolderName = parentSegs[parentSegs.length - 1];
	const parsed = parseTeamFolderName(parentFolderName);
	if (!parsed) throw new Error("Parent team folder has no slug.");
	const slug = parsed.slug;
	const code = getBaseCodeFromSlug(slug) as string;
	if (!code) throw new Error("Parent team folder has no code.");
	const orgName = parsed.name;

	// Get full hierarchical pathId for the parent from its slug (e.g., "a", "a-1", "a-aa")
	const parentPathId = getPathIdFromSlug(slug) || null;

	// Resolve the root organization name (segment before the first "Teams" in the path)
	let orgRootNameForSlug = orgName;
	const segsForRoot = parentTeam.rootPath.split("/").filter(Boolean);
	const firstTeamsIdx = segsForRoot.indexOf("Teams");
	if (firstTeamsIdx > 0) {
		const orgFolder = segsForRoot[firstTeamsIdx - 1];
		const orgParsed = parseTeamFolderName(orgFolder);
		if (orgParsed?.name) orgRootNameForSlug = orgParsed.name;
	}

	const teamsDir = `${parentTeam.rootPath}/Teams`;
	await ensureFolder(vault, teamsDir);

	for (const suf of suffixes) {
		const childName = `${orgName} ${suf}`;
		const suffixSlug = slugifyName(suf);
		const childPathId = parentPathId
			? `${parentPathId}-${suffixSlug}`
			: suffixSlug;
		const childSlug = buildOrgChildSlug(
			orgRootNameForSlug,
			code,
			childPathId
		);
		const parentPathForChild = teamsDir;

		// Use the same creation path as "Add Team" and organization children
		await createTeamResources(
			app,
			childName,
			parentPathForChild,
			childSlug,
			childPathId,
			/* seedWithSampleData */ false
		);
	}
}

// Helper: derive pathId from teamSlug relative to teamName
function inferPathIdFromTeamSlug(
	teamName: string,
	teamSlug: string
): string | null {
	// teamSlug format: "<name-slug>[-<pathId>]-<code>"
	// Extract code
	const codeMatch = TEAM_CODE_RE.exec(teamSlug);
	if (!codeMatch) return null;
	const code = codeMatch[1];
	const left = teamSlug.slice(0, -1 * (code.length + 1));
	// Remove "<name-slug>" prefix if present
	const nameSlug = (teamName || "")
		.trim()
		.toLowerCase()
		.replace(/[‐‑‒–—―]/g, "-")
		.replace(/\s+/g, "-")
		.replace(/[^a-z0-9-]/g, "")
		.replace(/-+/g, "-")
		.replace(/^-+/, "")
		.replace(/-+$/, "");
	if (left === nameSlug) return null;
	if (left.startsWith(nameSlug + "-")) {
		return left.slice(nameSlug.length + 1) || null;
	}
	return null;
}

/**
 * Materialize the blueprint under the team root.
 * Default behavior:
 * - All folders and files are renamed to include the slug:
 *   - Folder: "<Name> (<slugified-name>[-<pathId>]-<code>)"
 *   - File:   "<Stem> (<slugified-stem>[-<pathId>]-<code>).md"
 * - Special cases:
 *   - "Initiatives" folder name uses buildResourceFolderName("initiatives", code, pathId)
 *   - Files named "Completed.md", "Initiatives.md", "Priorities.md" under "Initiatives"
 *     use buildResourceFileName to retain exact naming rules.
 * - You can disable slug renaming per node with renameWithSlug=false in the blueprint.
 *   This setting is inherited by children unless they explicitly set their own flag.
 * - For seedWithSampleData=false: blank file content; for true: use blueprint file content.
 */
async function materializeBlueprint(params: {
	app: App;
	targetRoot: string;
	code: string;
	pathId: string | null;
	seedWithSampleData: boolean;
}) {
	const { app, targetRoot, code, pathId, seedWithSampleData } = params;
	const vault = app.vault;

	async function writeNode(
		node: BlueprintNode,
		currentTargetDir: string,
		ancestorInitiatives: boolean,
		parentRenameEnabled: boolean
	) {
		// Inherit rename flag down the tree; default to true
		const selfRenameEnabled = (node as BlueprintNode & { renameWithSlug?: boolean }).renameWithSlug ?? true;
		const effectiveRename = parentRenameEnabled && selfRenameEnabled;

		if (node.type === "folder") {
			// Determine if this logical node is "Initiatives"
			const isNodeInitiatives =
				node.name.trim().toLowerCase() === "initiatives";

			// Choose folder name
			let folderName = node.name;

			if (effectiveRename) {
				if (isNodeInitiatives) {
					// "Initiatives (initiatives[-<pathId>]-<code>)"
					folderName = buildResourceFolderName(
						"initiatives",
						code,
						pathId
					);
				} else {
					// Generic: "<Name> (<slugified-name>[-<pathId>]-<code>)"
					const baseSlug = slugifyName(node.name);
					const folderSlug =
						baseSlug + (pathId ? `-${pathId}` : "") + `-${code}`;
					folderName = `${node.name} (${folderSlug})`;
				}
			} else {
				// No rename; keep original name (e.g., "Docs")
				folderName = node.name;
			}

			const newDir = joinPath(currentTargetDir, folderName);
			await ensureFolder(vault, newDir);

			for (const child of node.children ?? []) {
				await writeNode(
					child,
					newDir,
					isNodeInitiatives || ancestorInitiatives,
					effectiveRename
				);
			}
		} else {
			// File
			const stem = node.name.replace(/\.md$/i, "");
			let fileName = node.name;

			if (effectiveRename) {
				// If inside Initiatives, use specific builders for known stems
				const stemSlugLower = stem.trim().toLowerCase();
				const isKnownInitiativesStem =
					ancestorInitiatives &&
					(stemSlugLower === "completed" ||
						stemSlugLower === "initiatives" ||
						stemSlugLower === "priorities");

				if (isKnownInitiativesStem) {
					fileName = buildResourceFileName(
						stemSlugLower as "completed" | "initiatives" | "priorities",
						code,
						pathId
					);
				} else {
					// Generic: "<Stem> (<slugified-stem>[-<pathId>]-<code>).md"
					const genericSlug =
						slugifyName(stem) +
						(pathId ? `-${pathId}` : "") +
						`-${code}`;
					fileName = `${stem} (${genericSlug}).md`;
				}
			} else {
				// No rename; keep original file name
				fileName = node.name;
			}

			const targetPath = joinPath(currentTargetDir, fileName);
			if (!(await vault.adapter.exists(targetPath))) {
				const content =
					seedWithSampleData && typeof node.content === "string"
						? node.content
						: "";
				await vault.create(targetPath, content);
			}
		}
	}

	for (const top of NEW_TEAM_BLUEPRINT) {
		await writeNode(top, targetRoot, false, true);
	}
}