import { TFile, TFolder, Vault } from "obsidian";
import { parseTeamFolderName } from "./org-slugs";
import { getFolder } from "@platform/obsidian";
import type {
	TeamInfo as CanonicalTeamInfo,
	MemberInfo,
	MemberType,
} from "./org-types";
import { getDisplayNameFromAlias, TEAM_CODE_RE } from "@shared/identity";

export interface MutableSettings {
	teams?: CanonicalTeamInfo[];
}

interface DetectedFolderTeam {
	name: string;
	slug: string;
	rootPath: string;
	displayName: string;
}

function hyphenateName(s: string): string {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/-+/g, "-");
}

// Accept only real team folders named: "<Display> (<slug>)"
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
	const pm = parentSlug.match(TEAM_CODE_RE);
	const cm = childSlug.match(TEAM_CODE_RE);
	if (!pm || !cm || pm[1].toLowerCase() !== cm[1].toLowerCase()) return false;

	const pBase = parentSlug.slice(0, parentSlug.length - 1 - pm[1].length);
	const cBase = childSlug.slice(0, childSlug.length - 1 - cm[1].length);
	if (!cBase.toLowerCase().startsWith(pBase.toLowerCase() + "-"))
		return false;
	if (cBase.toLowerCase() === pBase.toLowerCase()) return false; // must differ
	return true;
}

/**
 * Remove leading emojis/symbols and excess whitespace from a display string.
 * Examples:
 *   "👋 Cam Bloomfield" -> "Cam Bloomfield"
 *   "  ⭐  Jane  Doe "  -> "Jane Doe"
 */
function stripLeadingEmojiAndSpace(s: string): string {
	const trimmed = s.replace(/\s+/g, " ").trim();
	// Remove common leading symbol or emoji sequences followed by space(s)
	// This targets most unicode emoji and dingbats at the beginning.
	const cleaned = trimmed.replace(
		/^(?:[\p{Extended_Pictographic}\p{Emoji}\p{Symbol}\p{So}\p{Sk}]+|\p{P}|\s)+\s*/u,
		""
	);
	return cleaned.trim();
}

/**
 * Attempt to extract members from HTML-like spans/marks using data attributes.
 *
 * Supported elements:
 *   <span ... data-template-key="members.assignee" data-member-slug="cam-bloomfield" data-member-type="teamMember">Cam Bloomfield</span>
 *   <mark ... data-template-key="members.assignee" data-member-slug="cam-bloomfield" data-member-type="teamMember">...</mark>
 *
 * Only the following data-member-type values are accepted:
 *   - "teamMember"           -> "member"
 *   - "delegateTeamMember"   -> "internal-team-member"
 *   - "delegateTeam"         -> "team"
 *   - "delegateExternal"     -> "external"
 *
 * All other values (e.g., "special") are ignored.
 */
function extractMembersFromHtml(content: string): Array<{
	alias: string;
	name: string;
	type: MemberType;
}> {
	const results: Array<{ alias: string; name: string; type: MemberType }> =
		[];

	if (!content) return results;

	const tagRegex = /<(span|mark)\b([^>]*?)>([\s\S]*?)<\/\1>/gi;

	let m: RegExpExecArray | null;
	while ((m = tagRegex.exec(content)) !== null) {
		const attrs = m[2] || "";
		const innerTextRaw = m[3] || "";

		// Require data-template-key="members.assignee" (exact) to avoid false positives.
		const hasMembersAssignee =
			/\bdata-template-key\s*=\s*["']members\.assignee["']/i.test(attrs);
		if (!hasMembersAssignee) continue;

		// Extract data-member-slug and data-member-type
		const slugMatch = /\bdata-member-slug\s*=\s*["']([^"']+)["']/i.exec(
			attrs
		);
		if (!slugMatch) continue;
		const aliasRaw = slugMatch[1].trim();
		if (!aliasRaw) continue;

		const typeMatch = /\bdata-member-type\s*=\s*["']([^"']+)["']/i.exec(
			attrs
		);
		const typeRaw = (typeMatch?.[1] || "").trim();

		// Only allow the new, whitelisted types
		let type: MemberType | null = null;
		switch (typeRaw) {
			case "teamMember":
				type = "member";
				break;
			case "delegateTeamMember":
				type = "internal-team-member";
				break;
			case "delegateTeam":
				type = "team";
				break;
			case "delegateExternal":
				type = "external";
				break;
			default:
				type = null; // ignore anything else (e.g., "special")
		}
		if (!type) continue;

		// Inner text as name (strip tags if any minimal HTML inside)
		const textStripped = innerTextRaw
			.replace(/<[^>]*>/g, "")
			.replace(/\s+/g, " ")
			.trim();

		// Remove any leading emoji/symbol decorations from the name
		const plainName = stripLeadingEmojiAndSpace(textStripped);

		const alias = aliasRaw;
		const name =
			plainName.length > 0 ? plainName : getDisplayNameFromAlias(alias);

		results.push({ alias, name, type });
	}

	return results;
}

export async function hydrateTeamsFromVault(
	vault: Vault,
	settings: MutableSettings
): Promise<number> {
	try {
		// 1) Collect all folders we can see by walking file parents upward
		const allFolders = new Set<TFolder>();
		for (const f of vault.getAllLoadedFiles()) {
			const parent = f.parent;
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
				continue;
			}

			// Extra guard: exclude special note containers that slipped through (unlikely now)
			const lowerBase = parsed.slug.replace(TEAM_CODE_RE, "");
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
				displayName: getDisplayNameFromAlias(parsed.name),
			});
		}

		slugTeams.sort((a, b) => a.displayName.localeCompare(b.displayName));

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
					continue;
				}
				const ok = isChildSlugOf(t.slug, parsed.slug);
				if (!ok) {
					continue;
				}
				if (!byPath.has(child.path)) {
					continue;
				}
				const node = byPath.get(t.rootPath)!;
				node.children.push(child.path);
			}
		}

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
		for (const [, info] of detectedBySlug.entries()) {
			const root = info.rootPath.replace(/\/+$/g, "");
			for (const af of allFiles) {
				if (
					af instanceof TFile &&
					af.extension === "md" &&
					(af.path === root || af.path.startsWith(root + "/"))
				) {
					const content = await vault.cachedRead(af);

					// Parse only the new HTML span/mark format with data-member-slug & data-member-type
					const extracted = extractMembersFromHtml(content);

					for (const m of extracted) {
						// De-duplicate by alias, prefer first occurrence
						if (!info.members.has(m.alias)) {
							info.members.set(m.alias, {
								name: m.name,
								type: m.type,
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
		for (const t of existing) {
			if (!t.slug) {
				continue;
			}
			const key = t.slug;
			if (!merged.has(key)) {
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
						const ra = rank(a.type ?? "member");
						const rb = rank(b.type ?? "member");
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

		settings.teams = canonical;

		return canonical.length;
	} catch {
		return Array.isArray(settings.teams) ? settings.teams.length : 0;
	}
}