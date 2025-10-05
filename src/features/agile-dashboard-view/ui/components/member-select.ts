import type { SettingsService } from "@settings";

export function buildGroupedMemberSelect(
	settingsService: SettingsService,
	initialAlias: string | null
): HTMLSelectElement {
	const select = document.createElement("select");

	type Entry = {
		alias: string;
		name: string;
		role: "member" | "internal-team-member" | "team" | "external";
		label: string;
	};

	const entries: Entry[] = [];
	const seen = new Set<string>();

	const normalizeAlias = (input: string): string => {
		if (!input) return "";
		let s = String(input).trim();
		if (s.startsWith("@")) s = s.slice(1);
		return s.toLowerCase();
	};

	const settings = settingsService.getRaw();
	const teams = settings.teams || [];

	for (const t of teams) {
		for (const m of t.members || []) {
			const aliasRaw =
				typeof m === "string"
					? m
					: (m as any)?.alias || (m as any)?.name || "";
			const alias = normalizeAlias(aliasRaw);
			if (!alias) continue;
			if (seen.has(alias)) continue;
			seen.add(alias);

			const dispName =
				(typeof m === "string" ? "" : (m as any)?.name) || alias;

			const lower = alias.toLowerCase();
			let role: Entry["role"] = "member";
			if (lower.endsWith("-ext")) role = "external";
			else if (lower.endsWith("-team")) role = "team";
			else if (lower.endsWith("-int")) role = "internal-team-member";

			const roleLabel =
				role === "member"
					? "Team Member"
					: role === "internal-team-member"
					? "Internal Team Member"
					: role === "team"
					? "Internal Team"
					: "External Delegate";

			const label = `${dispName} (${roleLabel} - ${alias})`;
			entries.push({ alias, name: dispName, role, label });
		}
	}

	const groupTeamMembers = entries
		.filter((e) => e.role === "member" || e.role === "internal-team-member")
		.sort((a, b) => a.name.localeCompare(b.name));
	const groupDelegatesInternalTeams = entries
		.filter((e) => e.role === "team")
		.sort((a, b) => a.name.localeCompare(b.name));
	const groupDelegatesExternal = entries
		.filter((e) => e.role === "external")
		.sort((a, b) => a.name.localeCompare(b.name));

	const addGroup = (label: string, group: Entry[]) => {
		if (group.length === 0) return;
		const og = document.createElement("optgroup");
		og.label = label;
		group.forEach((e) => {
			const opt = document.createElement("option");
			opt.value = e.alias;
			opt.text = e.label;
			og.appendChild(opt);
		});
		select.appendChild(og);
	};

	addGroup("Team Members", groupTeamMembers);
	addGroup("Delegates – Internal Teams", groupDelegatesInternalTeams);
	addGroup("Delegates – External", groupDelegatesExternal);

	const defRaw = settings.currentUserAlias || "";
	const def = normalizeAlias(defRaw);
	const all = [
		...groupTeamMembers,
		...groupDelegatesInternalTeams,
		...groupDelegatesExternal,
	];

	const preferred =
		initialAlias && all.some((e) => e.alias === initialAlias)
			? initialAlias
			: def && all.some((e) => e.alias === def)
			? def
			: all[0]?.alias ?? "";
	if (preferred) select.value = preferred;

	return select;
}
