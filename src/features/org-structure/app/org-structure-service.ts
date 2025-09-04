import type { App, EventRef, TAbstractFile, TFile } from "obsidian";
import type { AgileObsidianSettings } from "src/settings";
import { hydrateTeamsFromVault } from "../domain/org-detection";
import type { MemberInfo, TeamInfo } from "../domain/org-types";
import type {
	MembersBuckets,
	TeamNode,
	OrganizationNode,
	OrgStructureResult,
} from "../domain/org-api-types";
import {
	parseTeamFolderName,
	resolveTeamForPath,
	isChildSlugOf as slugIsChildOf,
} from "../domain/org-slugs";
import { getDisplayNameFromAlias } from "@shared/identity";

// Generic comparator for items that have a "name" property
function byNameAsc<T extends { name: string }>(a: T, b: T): number {
	return a.name.localeCompare(b.name);
}

function stableMemberType(
	m: MemberInfo
): "member" | "internal-team-member" | "team" | "external" {
	const alias = (m.alias || "").toLowerCase();
	if (alias.endsWith("-int")) return "internal-team-member";
	if (alias.endsWith("-team")) return "team";
	if (alias.endsWith("-ext")) return "external";
	// fallback to explicit type or default member
	return (m.type as any) === "internal-team-member" ||
		(m.type as any) === "team" ||
		(m.type as any) === "external"
		? (m.type as any)
		: "member";
}

function memberRank(
	kind: "member" | "internal-team-member" | "team" | "external"
): number {
	return kind === "member"
		? 0
		: kind === "internal-team-member"
		? 1
		: kind === "team"
		? 2
		: 3;
}

export function classifyMember(m: MemberInfo): {
	kind: "member" | "internal-team-member" | "team" | "external";
	label: string;
	rank: number;
} {
	const kind = stableMemberType(m);
	const label =
		kind === "external"
			? "External Delegate"
			: kind === "team"
			? "Internal Team"
			: kind === "internal-team-member"
			? "Internal Team Member"
			: "Team Member";
	return { kind, label, rank: memberRank(kind) };
}

export function bucketizeMembers(input: MemberInfo[]): MembersBuckets {
	const teamMembers: MemberInfo[] = [];
	const internalMembersDelegates: MemberInfo[] = [];
	const internalTeamDelegates: MemberInfo[] = [];
	const externalDelegates: MemberInfo[] = [];

	for (const m of input || []) {
		const kind = stableMemberType(m);
		if (kind === "member") teamMembers.push(m);
		else if (kind === "internal-team-member")
			internalMembersDelegates.push(m);
		else if (kind === "team") internalTeamDelegates.push(m);
		else externalDelegates.push(m);
	}

	const sortByDisplayName = (a: MemberInfo, b: MemberInfo) =>
		getDisplayNameFromAlias(a.alias).localeCompare(
			getDisplayNameFromAlias(b.alias)
		);

	teamMembers.sort(sortByDisplayName);
	internalMembersDelegates.sort(sortByDisplayName);
	internalTeamDelegates.sort(sortByDisplayName);
	externalDelegates.sort(sortByDisplayName);

	return {
		teamMembers,
		internalMembersDelegates,
		internalTeamDelegates,
		externalDelegates,
	};
}

/**
 * Compute direct-children map strictly via slug lineage and Teams/ folder convention.
 * Only direct subteams under "<parent.rootPath>/Teams/<Child>" are included.
 */
export function computeDirectChildrenMap(
	teams: TeamInfo[]
): Map<string, TeamInfo[]> {
	const children = new Map<string, TeamInfo[]>();
	for (const parent of teams) {
		const parentSlug = parent.slug?.toLowerCase();
		if (!parentSlug) continue;
		const parentRoot = parent.rootPath.replace(/\/+$/g, "");
		const teamsFolderPrefix = parentRoot + "/Teams/";

		for (const child of teams) {
			if (child === parent) continue;
			const childSlug = child.slug?.toLowerCase();
			if (!childSlug) continue;
			if (!slugIsChildOf(parentSlug, childSlug)) continue;

			const childRoot = child.rootPath.replace(/\/+$/g, "");
			if (!childRoot.startsWith(teamsFolderPrefix)) continue;
			const remainder = childRoot.slice(teamsFolderPrefix.length);
			// only direct children
			if (remainder.length === 0 || remainder.includes("/")) continue;

			if (!children.has(parent.rootPath))
				children.set(parent.rootPath, []);
			children.get(parent.rootPath)!.push(child);
		}
	}
	// sort children groups
	for (const arr of children.values()) arr.sort(byNameAsc);
	return children;
}

/**
 * Build nested TeamNode recursively from a TeamInfo.
 */
export function buildTeamNode(
	root: TeamInfo,
	childrenMap: Map<string, TeamInfo[]>
): TeamNode {
	const slug =
		root.slug ||
		(() => {
			const segs = root.rootPath.split("/").filter(Boolean);
			const name = segs[segs.length - 1] || "";
			const parsed = parseTeamFolderName(name);
			return parsed?.slug || "";
		})();

	const subteamsInfo = childrenMap.get(root.rootPath) ?? [];
	const subteams = subteamsInfo.map((c) => buildTeamNode(c, childrenMap));

	return {
		teamName: root.name,
		teamSlug: slug,
		teamFolderPath: root.rootPath,
		members: bucketizeMembers(root.members || []),
		subteams,
	};
}

/**
 * Compute basic view of orgs, orphan teams, and children map for UIs that want a flat view.
 */
export function computeOrgStructureView(teams: TeamInfo[] = []): {
	orgs: TeamInfo[];
	orphanTeams: TeamInfo[];
	children: Map<string, TeamInfo[]>;
} {
	const children = computeDirectChildrenMap(teams);

	const isChildPath = new Set<string>();
	for (const arr of children.values())
		for (const c of arr) isChildPath.add(c.rootPath);

	const orgs: TeamInfo[] = [];
	const orphans: TeamInfo[] = [];

	for (const t of teams) {
		const isParent = (children.get(t.rootPath)?.length ?? 0) > 0;
		const isChild = isChildPath.has(t.rootPath);
		if (isParent && !isChild) orgs.push(t);
		else if (!isParent && !isChild) orphans.push(t);
	}

	orgs.sort(byNameAsc);
	orphans.sort(byNameAsc);

	return { orgs, orphanTeams: orphans, children };
}

/**
 * Transform to public nested API output.
 */
export function toOrgStructureResult(
	teams: TeamInfo[] = []
): OrgStructureResult {
	const { orgs, orphanTeams, children } = computeOrgStructureView(teams);

	const organizations: OrganizationNode[] = orgs.map((org) => {
		const slug = org.slug || "";
		const firstLevelTeams = (children.get(org.rootPath) ?? []).map((t) =>
			buildTeamNode(t, children)
		);
		return {
			orgName: org.name,
			orgSlug: slug,
			orgFolderPath: org.rootPath,
			members: bucketizeMembers(org.members || []),
			teams: firstLevelTeams,
		};
	});

	const orphanTeamNodes: TeamNode[] = orphanTeams.map((t) =>
		buildTeamNode(t, children)
	);

	return { organizations, teams: orphanTeamNodes };
}

export type OrgStructurePort = {
	getOrgStructure: () => OrgStructureResult;
	getTeamMembersForFile: (filePath: string) => {
		members: MemberInfo[];
		buckets: MembersBuckets;
		team: TeamInfo | null;
	};
};

/**
 * Service: maintains up-to-date snapshot and exposes a port.
 */
export function createOrgStructureService(opts: {
	app: App;
	settings: AgileObsidianSettings;
}): {
	buildAll: () => Promise<void>;
	getOrgStructure: () => OrgStructureResult;
	getTeamMembersForPath: (filePath: string) => {
		members: MemberInfo[];
		buckets: MembersBuckets;
		team: TeamInfo | null;
	};
	dispose: () => void;
	port: OrgStructurePort;
} {
	const { app, settings } = opts;

	let disposed = false;
	let rebuildTimer: number | null = null;
	const eventRefs: EventRef[] = [];

	// Debounced rebuild to coalesce rapid vault events
	const scheduleRebuild = () => {
		if (disposed) return;
		if (rebuildTimer !== null) window.clearTimeout(rebuildTimer);
		rebuildTimer = window.setTimeout(() => {
			rebuildTimer = null;
			void buildAll();
		}, 400);
	};

	// Only care about relevant files/folders; skip hidden/system paths
	const shouldCare = (file: TAbstractFile | null | undefined): boolean => {
		if (!file) return false;
		const p = (file as any).path as string | undefined;
		if (!p) return false;

		// Ignore Obsidian internals and trash
		const lower = p.toLowerCase();
		if (lower.startsWith(".obsidian/") || lower.includes("/.obsidian/"))
			return false;
		if (lower.startsWith(".trash/") || lower.includes("/.trash/"))
			return false;

		// Files: only markdown edits affect member detection; folders affect structure
		if ((file as TFile).extension !== undefined) {
			return (file as TFile).extension.toLowerCase() === "md";
		}

		// Folders: relevant (naming/relocation can change org detection)
		return true;
	};

	async function buildAll() {
		if (disposed) return;
		try {
			await hydrateTeamsFromVault(app.vault, settings as any);
			// hydrate mutates settings.teams in memory.
		} catch (e) {
			console.warn("[OrgStructureService] buildAll failed:", e);
		}
	}

	function getOrgStructure(): OrgStructureResult {
		const teams = Array.isArray(settings.teams)
			? (settings.teams as TeamInfo[])
			: [];
		return toOrgStructureResult(teams);
	}

	function getTeamMembersForPath(filePath: string) {
		const teams = Array.isArray(settings.teams)
			? (settings.teams as TeamInfo[])
			: [];
		const team = resolveTeamForPath(filePath, teams);
		const members: MemberInfo[] = team?.members ? team.members.slice() : [];
		const buckets = bucketizeMembers(members);
		// Sort flat members by classify and display name for convenience
		const sortedMembers = members
			.slice()
			.sort((a: MemberInfo, b: MemberInfo) => {
				const ca = classifyMember(a),
					cb = classifyMember(b);
				if (ca.rank !== cb.rank) return ca.rank - cb.rank;
				return getDisplayNameFromAlias(a.alias).localeCompare(
					getDisplayNameFromAlias(b.alias)
				);
			});
		return { members: sortedMembers, buckets, team: team ?? null };
	}

	// Register listeners now so the org structure stays current as the vault changes
	const startWatching = () => {
		const onEvt = (f: TAbstractFile) => {
			if (shouldCare(f)) scheduleRebuild();
		};
		eventRefs.push(app.vault.on("create", onEvt));
		eventRefs.push(app.vault.on("modify", onEvt));
		eventRefs.push(app.vault.on("delete", onEvt));
		eventRefs.push(app.vault.on("rename", onEvt));
	};

	startWatching();
	// Initial hydration
	void buildAll();

	function dispose() {
		disposed = true;
		if (rebuildTimer !== null) {
			window.clearTimeout(rebuildTimer);
			rebuildTimer = null;
		}
		for (const ref of eventRefs) app.vault.offref(ref);
		eventRefs.length = 0;
	}

	const port: OrgStructurePort = {
		getOrgStructure,
		getTeamMembersForFile: getTeamMembersForPath,
	};

	return {
		buildAll,
		getOrgStructure,
		getTeamMembersForPath,
		dispose,
		port,
	};
}
