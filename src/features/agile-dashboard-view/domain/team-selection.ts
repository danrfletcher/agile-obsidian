import type { SettingsService } from "@settings";
import type { OrgStructurePort } from "@features/org-structure";
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
	private load() {
		try {
			const raw = window.localStorage.getItem(this.storageKey);
			if (raw === null) {
				this.implicitAllSelected = true;
				this.selectedTeamSlugs = new Set();
				return;
			}
			this.implicitAllSelected = false;
			const arr = JSON.parse(raw);
			if (Array.isArray(arr)) {
				this.selectedTeamSlugs = new Set(
					arr.map((s) => String(s).toLowerCase())
				);
			} else {
				this.selectedTeamSlugs = new Set();
			}
		} catch {
			this.implicitAllSelected = true;
			this.selectedTeamSlugs = new Set();
		}
	}

	private persist() {
		try {
			this.implicitAllSelected = false;
			const arr = Array.from(this.selectedTeamSlugs.values());
			window.localStorage.setItem(this.storageKey, JSON.stringify(arr));
		} catch {}
	}

	// Public selection API
	getImplicitAllSelected(): boolean {
		return this.implicitAllSelected;
	}
	setImplicitAllSelected(val: boolean) {
		this.implicitAllSelected = val;
	}

	getSelectedTeamSlugs(): Set<string> {
		return this.selectedTeamSlugs;
	}

	addSelectedSlugs(slugs: string[]) {
		slugs.forEach((s) =>
			this.selectedTeamSlugs.add((s || "").toLowerCase())
		);
		this.persist();
	}
	removeSelectedSlugs(slugs: string[]) {
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
			(anyObj as any).alias ??
			(anyObj as any).user ??
			(anyObj as any).name ??
			(anyObj as any).id ??
			(anyObj as any).email;
		return this.normalizeAlias(
			typeof cand === "string" ? cand : String(cand || "")
		);
	}

	private extractAliases(members: unknown): string[] {
		if (!members) return [];
		if (Array.isArray(members)) {
			return members
				.map((m) => this.aliasFromMemberLike(m))
				.filter(Boolean);
		}
		if (typeof members === "object") {
			return Object.values(members)
				.map((v) => this.aliasFromMemberLike(v))
				.filter(Boolean);
		}
		return [];
	}

	private teamNodeHasUser(node: any, aliasNorm: string): boolean {
		const pools = [
			node?.members,
			node?.memberAliases,
			node?.users,
			node?.aliases,
			node?.membersMap,
			node?.allMembers,
		];
		for (const pool of pools) {
			const aliases = this.extractAliases(pool);
			if (aliases.includes(aliasNorm)) return true;
		}
		return false;
	}

	private tryPortMembershipMethods(aliasNorm: string): Set<string> | null {
		if (!this.orgStructurePort) return null;
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
					const raw = (fn as any).call(
						this.orgStructurePort,
						aliasNorm
					);
					if (Array.isArray(raw)) {
						const set = new Set<string>();
						for (const item of raw) {
							if (typeof item === "string") {
								const slug = item.toLowerCase().trim();
								if (slug) set.add(slug);
							} else if (item && typeof item === "object") {
								const cand =
									(item as any).slug ??
									(item as any).teamSlug ??
									(item as any).id ??
									(item as any).key ??
									(item as any).code;
								const slug =
									typeof cand === "string"
										? cand.toLowerCase().trim()
										: String(cand || "")
												.toLowerCase()
												.trim();
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

			const visitTeam = (node: any) => {
				const cand =
					node?.slug ??
					node?.teamSlug ??
					node?.id ??
					node?.key ??
					node?.code;
				const slug =
					typeof cand === "string"
						? cand.toLowerCase().trim()
						: String(cand || "")
								.toLowerCase()
								.trim();
				if (slug && this.teamNodeHasUser(node, aliasNorm))
					result.add(slug);
				for (const st of (node.subteams as any[] | undefined) || [])
					visitTeam(st);
			};

			for (const org of organizations || [])
				for (const t of org.teams || []) visitTeam(t);
			for (const t of teams || []) visitTeam(t);

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
			const teams = settings.teams || [];
			const result = new Set<string>();
			for (const t of teams) {
				const slug = (t as any).slug ?? (t as any).teamSlug ?? "";
				const slugNorm = String(slug || "")
					.toLowerCase()
					.trim();
				if (!slugNorm) continue;
				const members = (t as any).members || [];
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

	restrictSelectedTeamsToUserMembership(selectedAlias: string | null) {
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
			const { team } =
				this.orgStructurePort.getTeamMembersForFile(filePath);
			const slug = (team?.slug || "").toLowerCase().trim();
			return slug || null;
		} catch {
			return null;
		}
	}

	isTaskAllowedByTeam(task: TaskItem, selectedAlias: string | null): boolean {
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
	buildTeamsPopupContext() {
		return {
			selectedTeamSlugs: this.selectedTeamSlugs,
			implicitAllSelected: this.implicitAllSelected,
		};
	}
}
