import { App } from "obsidian";
import {
	buildResourceFileName,
	buildResourceFolderName,
	getBaseCodeFromSlug,
	parseTeamFolderName,
	buildTeamSlug,
	slugifyName,
} from "src/utils/commands/commandUtils";

export async function createTeamResources(
	app: App,
	teamName: string,
	parentPath: string,
	teamSlug: string,
	resourcePathIdOverride?: string | null
): Promise<{ info: { name: string; slug: string; rootPath: string } }> {
	const vault = app.vault;

	// Team folder will be created after deriving canonical slug

	// Get the 6-char code and any pathId from teamSlug
	const code = getBaseCodeFromSlug(teamSlug);
	if (!code) throw new Error("Invalid team slug; unable to derive code");

	// Create Initiatives folder directly under the team root (no Projects folder)
	// buildResourceFolderName("initiatives", code, pathId?) will parse from the slug when used elsewhere,
	// but here we rely on the teamSlug to get code above and keep pathId derived in callers for files below.
	// Determine pathId by parsing against the team folder name’s base

	// Build the Initiatives folder name by using team’s pathId (if present) consistently in files
	// The folder itself follows the convention:
	//   "Initiatives (initiatives[-<pathId>]-<code>)"
	// To extract pathId relative to team name, we can just compute it from the teamSlug using the utils:
	// Safer approach: reuse buildResourceFolderName with team’s code + inferred pathId; callers already pass correct teamSlug.
	// Get pathId by comparing teamSlug to base team name
	// Note: We don’t strictly need to compute pathId for creating the folder name; resource folder name only needs code and the same pathId used in the teamSlug.
	// We’ll use a helper method: inferPathIdFromTeamSlug
	const inferredPathId = inferPathIdFromTeamSlug(teamName, teamSlug);
	const effectivePathId = resourcePathIdOverride ?? inferredPathId;
	const baseNameSlug = slugifyName(teamName);
	const canonicalPathId =
		effectivePathId && baseNameSlug.endsWith(`-${effectivePathId}`) ? null : effectivePathId;
	const canonicalSlug = buildTeamSlug(teamName, code, canonicalPathId);

	// Create the team root folder: "<Name> (<canonicalSlug>)"
	const teamFolderName = `${teamName} (${canonicalSlug})`;
	const normalizedParent = (parentPath || "").replace(/\/+$/g, "");
	const teamRoot = normalizedParent ? `${normalizedParent}/${teamFolderName}` : teamFolderName;
	if (!(await vault.adapter.exists(teamRoot))) {
		await vault.createFolder(teamRoot);
	}

	// Ensure Docs folder
	const docs = `${teamRoot}/Docs`;
	if (!(await vault.adapter.exists(docs))) {
		await vault.createFolder(docs);
	}

	const initDirName = buildResourceFolderName("initiatives", code, effectivePathId);
	const initDir = `${teamRoot}/${initDirName}`;
	if (!(await vault.adapter.exists(initDir))) {
		await vault.createFolder(initDir);
	}

	// Create the three files in the Initiatives folder
	const completedFile = `${initDir}/${buildResourceFileName(
		"completed",
		code,
		effectivePathId
	)}`;
	const initiativesFile = `${initDir}/${buildResourceFileName(
		"initiatives",
		code,
		effectivePathId
	)}`;
	const prioritiesFile = `${initDir}/${buildResourceFileName(
		"priorities",
		code,
		effectivePathId
	)}`;
	if (!(await vault.adapter.exists(completedFile)))
		await vault.create(completedFile, "");
	if (!(await vault.adapter.exists(initiativesFile)))
		await vault.create(initiativesFile, "");
	if (!(await vault.adapter.exists(prioritiesFile)))
		await vault.create(prioritiesFile, "");

	return {
		info: { name: teamName, slug: canonicalSlug, rootPath: teamRoot },
	};
}

// Helper: derive pathId from teamSlug relative to teamName
function inferPathIdFromTeamSlug(
	teamName: string,
	teamSlug: string
): string | null {
	// teamSlug format: "<name-slug>[-<pathId>]-<code>"
	// Extract code
	const codeMatch = /-([0-9][a-z0-9]{5})$/i.exec(teamSlug);
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
