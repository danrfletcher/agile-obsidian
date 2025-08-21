import { App, Vault } from "obsidian";
import { TeamInfo } from "./teamDetection";
import {
	basename,
	dirname,
	ensureFolder,
	joinPath,
	safeRename,
} from "../files/fsUtils";
import { buildResourceFileName, buildResourceFolderName, buildTeamSlug, parseTeamFolderName, getBaseCodeFromSlug, getPathIdFromSlug, slugifyName } from "src/utils/commands/commandUtils";

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
 * - Does NOT wrap the team in a new parent folder
 */
export async function createOrganizationFromTeam(opts: {
	vault: Vault;
	orgName: string;
	orgSlug: string;
	organizationsRoot?: string; // unused here; org remains at the current location
	team: TeamInfo;
}): Promise<Organization> {
	const { vault, orgName, orgSlug, team } = opts;

	// Validate team source
	if (!team.rootPath) throw new Error("Original team folder not found");

	const parentDir = dirname(team.rootPath);
	const currentFolderName = basename(team.rootPath);

	// Determine the stable 6-char code from current slug or provided orgSlug
	const parsed = parseTeamFolderName(currentFolderName);
	let code: string | null = parsed ? getBaseCodeFromSlug(parsed.slug) : null;
	if (!code) code = getBaseCodeFromSlug(orgSlug);
	if (!code) throw new Error("Could not determine team code for organization");

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

	return {
		name: orgName,
		slug: desiredSlug,
		rootPath: newRootPath,
		teams: [],
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

  const letters = "abcdefghijklmnopqrstuvwxyz";

  // Determine already-used first-segment letters from existing child team slugs
  const existingChildren = app.vault.getAllLoadedFiles()
    .filter((f: any) => f?.path?.startsWith?.(teamsDir + "/") && f.children === undefined)
    // the above filter is broad; we’ll check presence via settings/parse as needed downstream
    ;

  // Prefer using known teams from your settings if passed around elsewhere; here we rely on folder parsing:
  const usedLetters = new Set<string>();
  // We cannot list folders reliably with getAllLoadedFiles subsets; instead, infer letters by scanning settings elsewhere.
  // If you maintain org children in settings, consider passing them here for more deterministic behavior.

  // Fallback strategy: quickly scan subfolder names via adapter.list (if available)
  try {
    const list = await (app.vault.adapter as any).list(teamsDir);
    const folders: string[] = Array.isArray(list?.folders) ? list.folders : [];
    for (const full of folders) {
      const name = full.split("/").filter(Boolean).pop()!;
      const p = parseTeamFolderName(name);
      if (p) {
        const base = slugifyName(p.name);
        const pid = getPathIdFromSlug(p.slug, base);
        if (pid) {
          const first = pid.split("-")[0];
          if (first) usedLetters.add(first);
        }
      }
    }
  } catch {
    // If adapter.list is not available, we proceed with empty usedLetters and let slug generation pick earliest letters.
  }

  let letterIdx = 0;
  while (letterIdx < letters.length && usedLetters.has(letters[letterIdx])) {
    letterIdx++;
  }

  for (let i = 0; i < suffixes.length; i++) {
    const letter = letters[letterIdx] || `x${letterIdx}`;
    letterIdx++;
    while (letterIdx < letters.length && usedLetters.has(letters[letterIdx])) {
      letterIdx++;
    }

    const pathId = letter;
    const name = `${orgName} ${suffixes[i]}`;
    const slug = buildTeamSlug(orgName, code, pathId);
    const folder = `${teamsDir}/${name} (${slug})`;

    if (!(await app.vault.adapter.exists(folder))) {
      await app.vault.createFolder(folder);
    }

    // Seed Projects/Initiatives
    const projects = `${folder}/Projects`;
    if (!(await app.vault.adapter.exists(projects))) {
      await app.vault.createFolder(projects);
    }
    const initDirName = buildResourceFolderName("initiatives", code, pathId);
    const initDir = `${projects}/${initDirName}`;
    if (!(await app.vault.adapter.exists(initDir))) {
      await app.vault.createFolder(initDir);
    }
    const completedFile = `${initDir}/${buildResourceFileName("completed", code, pathId)}`;
    const initiativesFile = `${initDir}/${buildResourceFileName("initiatives", code, pathId)}`;
    const prioritiesFile = `${initDir}/${buildResourceFileName("priorities", code, pathId)}`;
    if (!(await app.vault.adapter.exists(completedFile))) await app.vault.create(completedFile, "");
    if (!(await app.vault.adapter.exists(initiativesFile))) await app.vault.create(initiativesFile, "");
    if (!(await app.vault.adapter.exists(prioritiesFile))) await app.vault.create(prioritiesFile, "");
  }
}

/**
 * Create subteams under an existing team.
 * Produces Teams/<OrgName Suffix> (...) under the parent, with numeric suffix in pathId: a-1, a-2, etc.
 */
export async function createSubteams(
  app: App,
  parentTeam: TeamInfo,
  suffixes: string[]
): Promise<void> {
  const parentSegs = parentTeam.rootPath.split("/").filter(Boolean);
  const parentFolderName = parentSegs[parentSegs.length - 1];
  const parsed = parseTeamFolderName(parentFolderName);
  if (!parsed) throw new Error("Parent team folder has no slug.");
  const slug = parsed.slug;
  const code = getBaseCodeFromSlug(slug) as string;
  if (!code) throw new Error("Parent team folder has no code.");
  const orgName = parsed.name;
  const parentPathId = getPathIdFromSlug(slug, slugifyName(orgName)) || null; // e.g., "a" or "b-2"

  const teamsDir = `${parentTeam.rootPath}/Teams`;
  if (!(await app.vault.adapter.exists(teamsDir))) {
    await app.vault.createFolder(teamsDir);
  }

  // Determine next numeric suffix from existing subteams
  const usedNums = new Set<number>();
  try {
    const list = await (app.vault.adapter as any).list(teamsDir);
    const folders: string[] = Array.isArray(list?.folders) ? list.folders : [];
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
    const num = nextNum();
    const childPathId = parentPathId ? `${parentPathId}-${num}` : `${num}`;
    const name = `${orgName} ${suf}`;
    const slug = buildTeamSlug(orgName, code, childPathId);
    const folder = `${teamsDir}/${name} (${slug})`;

    if (!(await app.vault.adapter.exists(folder))) {
      await app.vault.createFolder(folder);
    }

    // Seed Projects/Initiatives
    const projects = `${folder}/Projects`;
    if (!(await app.vault.adapter.exists(projects))) {
      await app.vault.createFolder(projects);
    }
    const initDirName = buildResourceFolderName("initiatives", code, childPathId);
    const initDir = `${projects}/${initDirName}`;
    if (!(await app.vault.adapter.exists(initDir))) {
      await app.vault.createFolder(initDir);
    }
    const completedFile = `${initDir}/${buildResourceFileName("completed", code, childPathId)}`;
    const initiativesFile = `${initDir}/${buildResourceFileName("initiatives", code, childPathId)}`;
    const prioritiesFile = `${initDir}/${buildResourceFileName("priorities", code, childPathId)}`;
    if (!(await app.vault.adapter.exists(completedFile))) await app.vault.create(completedFile, "");
    if (!(await app.vault.adapter.exists(initiativesFile))) await app.vault.create(initiativesFile, "");
    if (!(await app.vault.adapter.exists(prioritiesFile))) await app.vault.create(prioritiesFile, "");
  }
}
