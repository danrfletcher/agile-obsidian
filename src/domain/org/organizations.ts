import { App } from "obsidian";
import {
	basename,
	dirname,
	ensureFolder,
	joinPath,
	safeRename,
} from "src/infra/persistence/fs-utils";
import {
	buildResourceFileName,
	buildResourceFolderName,
	buildTeamSlug,
	buildOrgChildSlug,
	parseTeamFolderName,
	getBaseCodeFromSlug,
	getPathIdFromSlug,
	slugifyName,
} from "src/domain/slugs/slug-utils";
import { createTeamResources } from "./creation";
import { TeamInfo } from "src/app/config/settings.types";

export interface Organization {
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
			const list = await (vault.adapter as any).list(teamsDir);
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
				pid
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
		const list = await (app.vault.adapter as any).list(teamsDir);
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

	// Using slugified team names for pathIds; no letter index allocation required.

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

		// Create Docs once (fix duplicate const bug)
		const docs = `${folder}/Docs`;
		if (!(await app.vault.adapter.exists(docs))) {
			await app.vault.createFolder(docs);
		}

		// Seed Projects/Initiatives
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
 * This now mirrors the organization child creation flow and reuses createTeamResources.
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
	if (!(await vault.adapter.exists(teamsDir))) {
		await vault.createFolder(teamsDir);
	}

	// Determine next numeric suffix from existing subteams
	const usedNums = new Set<number>();
	try {
		const list = await (vault.adapter as any).list(teamsDir);
		const folders: string[] = Array.isArray(list?.folders)
			? list.folders
			: [];
		for (const full of folders) {
			const name = full.split("/").filter(Boolean).pop()!;
			const p = parseTeamFolderName(name);
			if (p) {
				const base = slugifyName(p.name);
				const pid = getPathIdFromSlug(p.slug, base);
				if (pid) {
					const parts = pid.split("-");
					const last = parts[parts.length - 1];
					const n = parseInt(last, 10);
					if (Number.isFinite(n)) usedNums.add(n);
				}
			}
		}
	} catch {
		// If list fails, we'll start from 1
	}

	let n = 1;
	const nextNum = () => {
		while (usedNums.has(n)) n++;
		const val = n;
		usedNums.add(n);
		return val;
	};

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
			childPathId
		);
	}
}
