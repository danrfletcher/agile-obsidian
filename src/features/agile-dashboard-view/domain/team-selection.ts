/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import type { SettingsService } from "@settings";
import type {
	OrgStructurePort,
	MembersBuckets,
	TeamNode,
	TeamInfo,
} from "@features/org-structure";
import type { TaskItem } from "@features/task-index";

export class TeamSelection {
	private selectedTeamSlugs = new Set<string>();
	private implicitAllSelected = true;
	private readonly storageKey: string;

	constructor(
		private readonly settingsService: SettingsService,
		private readonly orgStructurePort: OrgStructurePort | undefined,
		storageKey: string
	) {
		this.storageKey = storageKey;
		this.load();
	}

	// Persistence
	private load(): void {
		try {
			const raw = window.localStorage.getItem(this.storageKey);
			if (raw === null) {
				this.implicitAllSelected = true;
				this.selectedTeamSlugs = new Set();
				return;
			}

			this.implicitAllSelected = false;

			const parsed: unknown = JSON.parse(raw);

			if (
				Array.isArray(parsed) &&
				parsed.every(
					(s): s is string | number =>
						typeof s === "string" || typeof s === "number"
				)
			) {
				const normalized = parsed.map((s) => String(s).toLowerCase());
				this.selectedTeamSlugs = new Set(normalized);
			} else {
				this.selectedTeamSlugs = new Set();
			}
		} catch {
			this.implicitAllSelected = true;
			this.selectedTeamSlugs = new Set();
		}
	}

	private persist(): void {
		try {
			this.implicitAllSelected = false;
			const arr = Array.from(this.selectedTeamSlugs.values());
			window.localStorage.setItem(this.storageKey, JSON.stringify(arr));
		} catch {
			/* ignore */
		}
	}

	// Public selection API
	getImplicitAllSelected(): boolean {
		return this.implicitAllSelected;
	}
	setImplicitAllSelected(val: boolean): void {
		this.implicitAllSelected = val;
	}

	getSelectedTeamSlugs(): Set<string> {
		return this.selectedTeamSlugs;
	}

	addSelectedSlugs(slugs: string[]): void {
		slugs.forEach((s) =>
			this.selectedTeamSlugs.add((s || "").toLowerCase())
		);
		this.persist();
	}
	removeSelectedSlugs(slugs: string[]): void {
		slugs.forEach((s) =>
			this.selectedTeamSlugs.delete((s || "").toLowerCase())
		);
		this.persist();
	}

	// Membership derivation
	private normalizeAlias(input: string): string {
		if (!input) return "";
		let s = String(input).trim();
		if (s.startsWith("@")) s = s.slice(1);
		return s.toLowerCase();
	}

	private aliasFromMemberLike(x: unknown): string {
		if (typeof x === "string") return this.normalizeAlias(x);
		if (!x || typeof x !== "object") return "";

		const anyObj = x as Record<string, unknown>;

		const cand =
			anyObj.alias ??
			anyObj.user ??
			anyObj.name ??
			anyObj.id ??
			anyObj.email;

		if (typeof cand === "string" || typeof cand === "number") {
			return this.normalizeAlias(String(cand));
		}
		return "";
	}

	private extractAliases(members: unknown): string[] {
		if (!members) return [];
		if (Array.isArray(members)) {
			return members
				.map((m) => this.aliasFromMemberLike(m))
				.filter(Boolean);
		}
		if (typeof members === "object") {
			const out: string[] = [];
			for (const v of Object.values(members as Record<string, unknown>)) {
				if (Array.isArray(v)) {
					for (const e of v) {
						const a = this.aliasFromMemberLike(e);
						if (a) out.push(a);
					}
				} else {
					const a = this.aliasFromMemberLike(v);
					if (a) out.push(a);
				}
			}
			return out;
		}
		return [];
	}

	private teamNodeHasUserFromBuckets(
		buckets: MembersBuckets,
		aliasNorm: string
	): boolean {
		const pools = [
			buckets.teamMembers,
			buckets.internalMembersDelegates,
			buckets.internalTeamDelegates,
			buckets.externalDelegates,
		];
		for (const pool of pools) {
			const aliases = this.extractAliases(pool);
			if (aliases.includes(aliasNorm)) return true;
		}
		return false;
	}

	private tryPortMembershipMethods(aliasNorm: string): Set<string> | null {
		if (!this.orgStructurePort) return null;

		// Note: this is intentionally very loose and guarded with typeof checks
		// because we're probing for optional methods on a port.
		const port = this.orgStructurePort as unknown as Record<
			string,
			unknown
		>;
		const candidates = [
			"getTeamsForUser",
			"getTeamSlugsForUser",
			"getUserTeams",
			"getTeamsByUser",
		];

		for (const fnName of candidates) {
			const fn = port[fnName];
			if (typeof fn === "function") {
				try {
					const raw = (fn as (alias: string) => unknown).call(
						this.orgStructurePort as unknown as object,
						aliasNorm
					);
					if (Array.isArray(raw)) {
						const set = new Set<string>();
						for (const item of raw as unknown[]) {
							if (typeof item === "string") {
								const slug = item.toLowerCase().trim();
								if (slug) set.add(slug);
							} else if (item && typeof item === "object") {
								const obj = item as Record<string, unknown>;
								const cand =
									obj.slug ??
									obj.teamSlug ??
									obj.id ??
									obj.key ??
									obj.code;

								let slug = "";
								if (
									typeof cand === "string" ||
									typeof cand === "number"
								) {
									slug = String(cand)
										.toLowerCase()
										.trim();
								}
								if (slug) set.add(slug);
							}
						}
						if (set.size > 0) return set;
					}
				} catch {
					/* ignore */
				}
			}
		}
		return null;
	}

	private deriveMembershipFromStructure(
		aliasNorm: string
	): Set<string> | null {
		if (!this.orgStructurePort) return null;
		try {
			const { organizations, teams } =
				this.orgStructurePort.getOrgStructure();
			const result = new Set<string>();

			const visitTeam = (node: TeamNode) => {
				const slug = String(node.teamSlug || "")
					.toLowerCase()
					.trim();
				if (
					slug &&
					this.teamNodeHasUserFromBuckets(node.members, aliasNorm)
				) {
					result.add(slug);
				}
				for (const st of node.subteams ?? []) {
					visitTeam(st);
				}
			};

			const orgs = organizations ?? [];
			const orphanTeams = teams ?? [];

			for (const org of orgs) {
				for (const t of org.teams ?? []) {
					visitTeam(t);
				}
			}

			for (const t of orphanTeams) {
				visitTeam(t);
			}

			return result.size > 0 ? result : new Set<string>();
		} catch {
			return null;
		}
	}

	private deriveMembershipFromSettings(
		aliasNorm: string
	): Set<string> | null {
		try {
			const settings = this.settingsService.getRaw();
			const teams: TeamInfo[] = settings.teams || [];
			const result = new Set<string>();
			for (const t of teams) {
				const rawSlug = t.slug;
				const slugNorm =
					typeof rawSlug === "string" ||
					typeof rawSlug === "number"
						? String(rawSlug).toLowerCase().trim()
						: "";
				if (!slugNorm) continue;
				const members = t.members || [];
				const aliases = this.extractAliases(members);
				if (aliases.includes(aliasNorm)) result.add(slugNorm);
			}
			return result.size > 0 ? result : new Set<string>();
		} catch {
			return null;
		}
	}

	getAllowedTeamSlugsForSelectedUser(
		selectedAlias: string | null
	): Set<string> | null {
		const aliasNorm = this.normalizeAlias(selectedAlias || "");
		if (!aliasNorm) return null;
		const fromPortMethods = this.tryPortMembershipMethods(aliasNorm);
		const fromStructure = this.deriveMembershipFromStructure(aliasNorm);
		const fromSettings = this.deriveMembershipFromSettings(aliasNorm);
		const union = new Set<string>();
		for (const s of [fromPortMethods, fromStructure, fromSettings]) {
			if (!s) continue;
			for (const x of s) union.add(x);
		}
		return union.size > 0 ? union : null;
	}

	restrictSelectedTeamsToUserMembership(selectedAlias: string | null): void {
		const allowed = this.getAllowedTeamSlugsForSelectedUser(selectedAlias);
		if (!allowed) return;
		if (this.selectedTeamSlugs.size === 0) return;
		const before = this.selectedTeamSlugs.size;
		for (const s of Array.from(this.selectedTeamSlugs)) {
			if (!allowed.has(s)) this.selectedTeamSlugs.delete(s);
		}
		if (this.selectedTeamSlugs.size !== before) this.persist();
	}

	getTeamSlugForFile(filePath: string): string | null {
	try {
		if (!this.orgStructurePort) return null;

		const result = this.orgStructurePort.getTeamMembersForFile(filePath);
		const team: TeamInfo | null = result.team;

		if (!team) return null;

		const slugValue = team.slug;

		if (
			typeof slugValue === "string" ||
			typeof slugValue === "number"
		) {
			const slug = String(slugValue).toLowerCase().trim();
			return slug || null;
		}

		return null;
	} catch {
		return null;
	}
}

	isTaskAllowedByTeam(
		task: TaskItem,
		selectedAlias: string | null
	): boolean {
		const filePath =
			task.link?.path || (task._uniqueId?.split(":")[0] ?? "");
		if (!filePath) return false;

		const allowedByUser =
			this.getAllowedTeamSlugsForSelectedUser(selectedAlias);

		if (this.implicitAllSelected) {
			if (!this.orgStructurePort) return true;
			const teamSlug = this.getTeamSlugForFile(filePath);
			if (!allowedByUser) return true;
			if (!teamSlug) return false;
			return allowedByUser.has(teamSlug);
		}

		if (this.selectedTeamSlugs.size === 0) return false;

		const teamSlug = this.getTeamSlugForFile(filePath);
		if (!teamSlug) return false;

		const inSelected = this.selectedTeamSlugs.has(teamSlug);
		if (!inSelected) return false;

		if (allowedByUser) return allowedByUser.has(teamSlug);
		return true;
	}

	// Expose state for Teams popup
	buildTeamsPopupContext(): {
		selectedTeamSlugs: Set<string>;
		implicitAllSelected: boolean;
	} {
		return {
			selectedTeamSlugs: this.selectedTeamSlugs,
			implicitAllSelected: this.implicitAllSelected,
		};
	}
}