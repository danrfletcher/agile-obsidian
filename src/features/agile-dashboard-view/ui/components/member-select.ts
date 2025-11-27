import type { SettingsService } from "@settings";
import type { TeamInfo } from "@features/org-structure";

type MemberSelectFilter = {
	selectedTeamSlugs?: Set<string> | null;
	implicitAllSelected?: boolean;
};

type Entry = {
	alias: string;
	name: string;
	role: "member" | "internal-team-member" | "team" | "external";
	label: string;
};

const normalizeAlias = (input: string): string => {
	if (!input) return "";
	let s = String(input).trim();
	if (s.startsWith("@")) s = s.slice(1);
	return s.toLowerCase();
};

function computeEntries(
	settingsService: SettingsService,
	filter?: MemberSelectFilter
): Entry[] {
	const settings = settingsService.getRaw();
	const teams: TeamInfo[] = settings.teams || [];

	// Determine which teams to include
	const selectedSet = filter?.selectedTeamSlugs ?? null;
	const implicitAll = !!filter?.implicitAllSelected;
	const includeAllTeams =
		implicitAll || !selectedSet || selectedSet.size === 0;

	const includedTeams = includeAllTeams
		? teams
		: teams.filter((t) => {
				const slug = (t.slug ?? "").toString().toLowerCase().trim();
				return slug && selectedSet?.has(slug);
		  });

	const entries: Entry[] = [];
	const seen = new Set<string>();

	for (const t of includedTeams) {
		for (const m of t.members ?? []) {
			const aliasRaw =
				typeof m === "string" ? m : m.alias || m.name || "";
			const alias = normalizeAlias(aliasRaw);
			if (!alias) continue;
			if (seen.has(alias)) continue;
			seen.add(alias);

			const dispName = (typeof m === "string" ? "" : m.name) || alias;

			const lower = alias.toLowerCase();
			let role: Entry["role"] = "member";
			if (lower.endsWith("-ext")) role = "external";
			else if (lower.endsWith("-team")) role = "team";
			else if (lower.endsWith("-int")) role = "internal-team-member";

			const roleLabel =
				role === "member"
					? "Team member"
					: role === "internal-team-member"
					? "Internal team member"
					: role === "team"
					? "Internal team"
					: "External delegate";

			const label = `${dispName} (${roleLabel} - ${alias})`;
			entries.push({ alias, name: dispName, role, label });
		}
	}

	return entries;
}

function groupAndAppendOptions(select: HTMLSelectElement, entries: Entry[]) {
	select.innerHTML = "";

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

	addGroup("Team members", groupTeamMembers);
	addGroup("Delegates – internal teams", groupDelegatesInternalTeams);
	addGroup("Delegates – external", groupDelegatesExternal);
}

function resolveAppliedAlias(
	settingsService: SettingsService,
	availableAliases: string[],
	preferredAlias: string | null
): string | null {
	const defRaw = settingsService.getRaw().currentUserAlias || "";
	const def = normalizeAlias(defRaw);
	const all = new Set(availableAliases);

	if (preferredAlias && all.has(preferredAlias)) return preferredAlias;
	if (def && all.has(def)) return def;
	return availableAliases[0] || null;
}

/**
 * Create the grouped member select element and populate it.
 * If filter is provided, only members from the selected teams are included.
 */
export function buildGroupedMemberSelect(
	settingsService: SettingsService,
	initialAlias: string | null,
	filter?: MemberSelectFilter
): HTMLSelectElement {
	const select = document.createElement("select");

	const entries = computeEntries(settingsService, filter);
	groupAndAppendOptions(select, entries);

	const applied = resolveAppliedAlias(
		settingsService,
		entries.map((e) => e.alias),
		initialAlias ? normalizeAlias(initialAlias) : null
	);
	if (applied) select.value = applied;

	return select;
}

/**
 * Repopulate an existing grouped member select element based on filter and a preferred alias.
 * Returns the applied alias after the refresh (may differ from the preferred if not present).
 */
export function refreshGroupedMemberSelect(
	select: HTMLSelectElement,
	settingsService: SettingsService,
	preferredAlias: string | null,
	filter?: MemberSelectFilter
): string | null {
	const entries = computeEntries(settingsService, filter);
	groupAndAppendOptions(select, entries);

	const applied = resolveAppliedAlias(
		settingsService,
		entries.map((e) => e.alias),
		preferredAlias ? normalizeAlias(preferredAlias) : null
	);

	if (applied) {
		select.value = applied;
	} else {
		// No options available
		select.value = "";
	}

	return applied;
}