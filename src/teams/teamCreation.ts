// src/teams/teamCreation.ts
import type { App } from "obsidian";
import {
	buildResourceFolderName,
	buildResourceFileName,
} from "../utils/commands/commandUtils";
import { ensureFolder } from "../files/fsUtils";
import type { TeamInfo } from "../settings/settings.types";

export async function createTeamResources(
	app: App,
	teamName: string,
	parentPath: string,
	teamSlug: string
): Promise<{ info: TeamInfo; teamFolder: string }> {
	const normalizedParent =
		parentPath === "/" ? "" : parentPath.replace(/\/+$/g, "");
	const teamFolderName = `${teamName} (${teamSlug})`;
	const teamFolder = normalizedParent
		? `${normalizedParent}/${teamFolderName}`
		: teamFolderName;

	// Ensure the parent folder exists (e.g., "Teams") before creating the team folder
	if (normalizedParent) {
		await ensureFolder(app.vault, normalizedParent);
	}
	if (!(await app.vault.adapter.exists(teamFolder))) {
		await app.vault.createFolder(teamFolder);
	}
	const docsPath = `${teamFolder}/Docs`;
	if (!(await app.vault.adapter.exists(docsPath)))
		await app.vault.createFolder(docsPath);

	const projectsPath = `${teamFolder}/Projects`;
	if (!(await app.vault.adapter.exists(projectsPath)))
		await app.vault.createFolder(projectsPath);

	const code = teamSlug.split("-").pop()!; // base code is last segment in your slug scheme
	const initiativesFolderName = buildResourceFolderName(
		"initiatives",
		code,
		null
	);
	const initiativesDir = `${projectsPath}/${initiativesFolderName}`;
	if (!(await app.vault.adapter.exists(initiativesDir)))
		await app.vault.createFolder(initiativesDir);

	const completedFile = `${initiativesDir}/${buildResourceFileName(
		"completed",
		code,
		null
	)}`;
	const initiativesFile = `${initiativesDir}/${buildResourceFileName(
		"initiatives",
		code,
		null
	)}`;
	const prioritiesFile = `${initiativesDir}/${buildResourceFileName(
		"priorities",
		code,
		null
	)}`;
	if (!(await app.vault.adapter.exists(completedFile)))
		await app.vault.create(completedFile, "");
	if (!(await app.vault.adapter.exists(initiativesFile)))
		await app.vault.create(initiativesFile, "");
	if (!(await app.vault.adapter.exists(prioritiesFile)))
		await app.vault.create(prioritiesFile, "");

	const info: TeamInfo = {
		name: teamName,
		rootPath: teamFolder,
		members: [],
		slug: teamSlug,
	};
	return { info, teamFolder };
}
