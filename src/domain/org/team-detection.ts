import { TFile, TFolder, Vault } from "obsidian";
import { aliasToName, parseTeamFolderName } from "src/domain/slugs/slug-utils";
import { getFolder } from "src/infra/persistence/fs-utils";
import type {
	TeamInfo as CanonicalTeamInfo,
	MemberInfo,
	MemberType,
} from "src/app/config/settings.types";

type MutableSettings = {
	teamsFolder: string;
	teams?: CanonicalTeamInfo[];
	[k: string]: unknown;
};

interface DetectedFolderTeam {
	name: string;
	slug: string;
	rootPath: string;
	displayName: string;
}

const SLUG_CODE_RE = /-([0-9][a-z0-9]{5})$/i;

function hyphenateName(s: string): string {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/-+/g, "-");
}

// Accept only real team folders named: "<Display> (<slug>)"
// Reject known non-team bases like initiatives/completed/priorities.
function isTeamFolderName(folderName: string): boolean {
	const m = /^(.*)\s+\(([a-z0-9-]+)\)$/i.exec(folderName);
	if (!m) return false;
	const display = m[1].trim();
	const slug = m[2].trim().toLowerCase();

	const parts = slug.split("-");
	if (parts.length < 2) return false;

	const code = parts[parts.length - 1];
	if (!/^[0-9][a-z0-9]{5}$/i.test(code)) return false;

	const base = parts.slice(0, -1).join("-");
	const banned = new Set(["initiatives", "completed", "priorities"]);
	if (banned.has(base)) return false;

	// Basic sanity: base should start with hyphenated display (top-level) or be an extension (subteams)
	const h = hyphenateName(display);
	if (!(base === h || base.startsWith(h + "-"))) return false;

	return true;
}

// child is descendant of parent if:
// - shares the same 6-char code
// - child's base starts with parent's base + "-"
function isChildSlugOf(parentSlug: string, childSlug: string): boolean {
	const pm = parentSlug.match(SLUG_CODE_RE);
	const cm = childSlug.match(SLUG_CODE_RE);
	if (!pm || !cm || pm[1].toLowerCase() !== cm[1].toLowerCase()) return false;

	const pBase = parentSlug.slice(0, parentSlug.length - 1 - pm[1].length);
	const cBase = childSlug.slice(0, childSlug.length - 1 - cm[1].length);
	if (!cBase.toLowerCase().startsWith(pBase.toLowerCase() + "-"))
		return false;
	if (cBase.toLowerCase() === pBase.toLowerCase()) return false; // must differ
	return true;
}

export async function hydrateTeamsFromVault(
	vault: Vault,
	settings: MutableSettings
): Promise<number> {
	const TAG = "[hydrateTeamsFromVault]";
	try {
		// 1) Collect all folders we can see by walking file parents upward
		const allFolders = new Set<TFolder>();
		for (const f of vault.getAllLoadedFiles()) {
			const parent = (f as any).parent;
			if (parent && parent instanceof TFolder) {
				allFolders.add(parent);
				let cur: TFolder | null = parent;
				while (cur?.parent && cur.parent instanceof TFolder) {
					allFolders.add(cur.parent);
					cur = cur.parent;
				}
			}
		}

		// 2) Detect only valid team folders by their own name
		const slugTeams: DetectedFolderTeam[] = [];
		const seenSlugs = new Set<string>();
		for (const folder of allFolders) {
			const name = folder.name;
			if (!isTeamFolderName(name)) continue;

			const parsed = parseTeamFolderName(name);
			if (!parsed) continue;

			// De-dupe by slug
			if (seenSlugs.has(parsed.slug)) {
				console.warn(
					`${TAG} duplicate slug detected for different paths:`,
					{ slug: parsed.slug, path: folder.path }
				);
				continue;
			}

			// Extra guard: exclude special note containers that slipped through (unlikely now)
			const lowerBase = parsed.slug.replace(SLUG_CODE_RE, "");
			if (
				/(^|-)initiatives($|-)|(^|-)completed($|-)|(^|-)priorities($|-)/i.test(
					lowerBase
				)
			) {
				continue;
			}

			seenSlugs.add(parsed.slug);
			slugTeams.push({
				name: parsed.name,
				slug: parsed.slug,
				rootPath: folder.path,
				displayName: aliasToName(parsed.name),
			});
		}

		slugTeams.sort((a, b) => a.displayName.localeCompare(b.displayName));
		// Sanity duplicate checks
		{
			const pathCounts = new Map<string, number>();
			const nameCounts = new Map<string, number>();
			const slugCounts = new Map<string, number>();
			for (const t of slugTeams) {
				pathCounts.set(
					t.rootPath,
					(pathCounts.get(t.rootPath) ?? 0) + 1
				);
				nameCounts.set(t.name, (nameCounts.get(t.name) ?? 0) + 1);
				slugCounts.set(t.slug, (slugCounts.get(t.slug) ?? 0) + 1);
			}
			const dupPaths = Array.from(pathCounts.entries()).filter(
				([, c]) => c > 1
			);
			const dupNames = Array.from(nameCounts.entries()).filter(
				([, c]) => c > 1
			);
			const dupSlugs = Array.from(slugCounts.entries()).filter(
				([, c]) => c > 1
			);
			if (dupPaths.length)
				console.warn(
					`${TAG} duplicate rootPaths among slugTeams:`,
					dupPaths
				);
			if (dupNames.length)
				console.warn(
					`${TAG} duplicate names among slugTeams:`,
					dupNames
				);
			if (dupSlugs.length)
				console.warn(
					`${TAG} duplicate slugs among slugTeams (should not happen):`,
					dupSlugs
				);
		}

		// 3) Build parent-child relationships via Teams/ and slug lineage
		type Node = DetectedFolderTeam & { children: string[] }; // child rootPath[]
		const byPath = new Map<string, Node>();
		const bySlug = new Map<string, Node>();
		for (const t of slugTeams) {
			const node = { ...t, children: [] as string[] };
			byPath.set(t.rootPath, node);
			bySlug.set(t.slug, node);
		}

		for (const t of slugTeams) {
			const teamsFolderPath = `${t.rootPath}/Teams`;
			const teamsFolder = getFolder(vault, teamsFolderPath);
			if (!teamsFolder) continue;
			for (const child of teamsFolder.children) {
				if (!(child instanceof TFolder)) continue;
				const parsed = parseTeamFolderName(child.name);
				if (!parsed) {
					console.warn(
						`${TAG} Teams/ child folder name not parsable as team:`,
						child.path
					);
					continue;
				}
				const ok = isChildSlugOf(t.slug, parsed.slug);
				if (!ok) {
					console.warn(
						`${TAG} child slug not matching parent (ignored):`,
						{
							parent: t.slug,
							child: parsed.slug,
							childPath: child.path,
						}
					);
					continue;
				}
				if (!byPath.has(child.path)) {
					console.warn(
						`${TAG} child team folder parsed but not present in slugTeams set (skipped):`,
						child.path
					);
					continue;
				}
				const node = byPath.get(t.rootPath)!;
				node.children.push(child.path);
			}
		}

		const parentsWithChildren = Array.from(byPath.values()).filter(
			(n) => n.children.length > 0
		);

		// 4) Build detected map keyed by slug (unique ID)
		const detectedBySlug = new Map<
			string,
			{
				name: string;
				rootPath: string;
				members: Map<string, { name: string; type: MemberType }>;
				slug: string;
			}
		>();
		for (const t of slugTeams) {
			detectedBySlug.set(t.slug, {
				name: t.name,
				rootPath: t.rootPath,
				members: new Map(),
				slug: t.slug,
			});
		}

		// 5) Extract members by scanning md files under each team root
		const allFiles = vault.getAllLoadedFiles();
		for (const [slug, info] of detectedBySlug.entries()) {
			const root = info.rootPath.replace(/\/+$/g, "");
			for (const af of allFiles) {
				if (
					af instanceof TFile &&
					af.extension === "md" &&
					(af.path === root || af.path.startsWith(root + "/"))
				) {
					const content = await vault.cachedRead(af);
					const re = /\b(?:active|inactive)-([a-z0-9-]+)\b/gi;
					let mm: RegExpExecArray | null;
					while ((mm = re.exec(content)) !== null) {
						const alias = mm[1];
						if (alias.toLowerCase() === "team") continue;
						const lower = alias.toLowerCase();
						const type: MemberType = lower.endsWith("-ext")
							? "external"
							: lower.endsWith("-team")
							? "team"
							: lower.endsWith("-int")
							? "internal-team-member"
							: "member";
						if (!info.members.has(alias)) {
							info.members.set(alias, {
								name: aliasToName(alias),
								type,
							});
						}
					}
				}
			}
		}

		// 6) Merge with existing settings (strict slug-only):
		// Keep ONLY detected slugs. If an existing entry has the same slug, we may keep its customized rootPath.
		const existing = Array.isArray(settings.teams) ? settings.teams : [];

		type Merged = {
			name: string;
			rootPath: string;
			members: Map<string, { name: string; type: MemberType }>;
			slug: string;
		};

		const merged = new Map<string, Merged>();

		// Seed with detected authoritative
		for (const [slug, info] of detectedBySlug.entries()) {
			merged.set(slug, {
				name: info.name,
				rootPath: info.rootPath,
				members: new Map(info.members),
				slug,
			});
		}

		// Carry forward rootPath overrides only for slugs we actually detected this run
		let updatedRootPaths = 0;
		let droppedExisting = 0;
		for (const t of existing) {
			if (!t.slug) {
				// Old or invalid entry without slug gets dropped in slug-only mode
				console.warn(
					`${TAG} dropping existing team without slug (slug-only mode):`,
					{ name: t.name, rootPath: t.rootPath }
				);
				droppedExisting++;
				continue;
			}
			const key = t.slug;
			if (!merged.has(key)) {
				console.warn(
					`${TAG} dropping existing team not found in detection:`,
					{ name: t.name, slug: key, rootPath: t.rootPath }
				);
				droppedExisting++;
				continue;
			}
			// If user customized rootPath previously, honor it
			const entry = merged.get(key)!;
			if (t.rootPath && t.rootPath !== entry.rootPath) {
				// Only honor overrides that still point to a valid team folder with the same slug
				const existingFolder = getFolder(vault, t.rootPath);
				const parsed = existingFolder
					? parseTeamFolderName(existingFolder.name)
					: null;
				if (parsed && parsed.slug.toLowerCase() === key.toLowerCase()) {
					entry.rootPath = t.rootPath;
					updatedRootPaths++;
				} else {
					console.warn(
						`${TAG} ignoring rootPath override that does not match slug; keeping detected path`,
						{
							name: t.name,
							slug: key,
							existingRootPath: t.rootPath,
							detectedRootPath: entry.rootPath,
						}
					);
				}
			}
		}

		// 7) Canonicalize
		const rank = (t: MemberType) =>
			t === "member"
				? 0
				: t === "internal-team-member"
				? 1
				: t === "team"
				? 2
				: 3;

		const canonical: CanonicalTeamInfo[] = Array.from(merged.values())
			.map((v) => {
				const members: MemberInfo[] = Array.from(v.members.entries())
					.map(([alias, meta]) => ({
						alias,
						name: meta.name,
						type: meta.type,
					}))
					.sort((a, b) => {
						const typeOf = (m: MemberInfo): MemberType =>
							m.type ??
							((m.alias || "").toLowerCase().endsWith("-ext")
								? "external"
								: (m.alias || "")
										.toLowerCase()
										.endsWith("-team")
								? "team"
								: (m.alias || "").toLowerCase().endsWith("-int")
								? "internal-team-member"
								: "member");
						const ra = rank(typeOf(a));
						const rb = rank(typeOf(b));
						if (ra !== rb) return ra - rb;
						return a.name.localeCompare(b.name);
					});

				const out: CanonicalTeamInfo = {
					name: v.name,
					rootPath: v.rootPath,
					members,
					slug: v.slug,
				};
				return out;
			})
			.sort((a, b) => a.name.localeCompare(b.name));

		// Name collisions are allowed across different slugs; warn for visibility only
		{
			const nameCounts = new Map<string, number>();
			for (const t of canonical)
				nameCounts.set(t.name, (nameCounts.get(t.name) ?? 0) + 1);
			const dup = Array.from(nameCounts.entries()).filter(
				([, c]) => c > 1
			);
			if (dup.length) {
				console.warn(
					`${TAG} duplicate display names in canonical list (different slugs):`,
					dup
				);
				for (const [n] of dup) {
					console.warn(
						`${TAG} entries for "${n}":`,
						canonical
							.filter((t) => t.name === n)
							.map((t) => ({
								slug: t.slug,
								rootPath: t.rootPath,
							}))
					);
				}
			}
		}

		settings.teams = canonical;

		console.timeEnd(`${TAG} total`);
		return canonical.length;
	} catch (err) {
		console.error(`${TAG} error:`, err);
		console.timeEnd(`${TAG} total`);
		return Array.isArray(settings.teams) ? settings.teams.length : 0;
	}
}
