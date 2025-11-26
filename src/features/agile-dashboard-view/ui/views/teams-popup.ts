import type {
	OrgStructurePort,
	OrganizationNode,
	TeamNode,
} from "@features/org-structure";

/**
 * Context/state/accessors needed to render the Teams popup.
 */
export interface TeamsPopupContext {
	root: HTMLDivElement;
	orgStructurePort?: OrgStructurePort;

	// Selection state owned by the view
	selectedTeamSlugs: Set<string>;
	implicitAllSelected: boolean;

	// State mutators
	setImplicitAllSelected(val: boolean): void;
	addSelectedSlugs(slugs: string[]): void;
	removeSelectedSlugs(slugs: string[]): void;

	// Called after any selection changes
	onSelectionChanged(): void;

	// Return allowed slugs for current user, or null when unknown (no filtering)
	getAllowedTeamSlugsForSelectedUser(): Set<string> | null;
}

/**
 * Render the entire content of the Teams popup into root.
 */
export function renderTeamsPopupContent(ctx: TeamsPopupContext) {
	const root = ctx.root;
	root.innerHTML = "";

	const header = root.createEl("div", {
		attr: {
			style: "display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:6px;",
		},
	});
	header.createEl("strong", { text: "Select Teams" });
	const help = header.createEl("span", {
		text: "Choose organizations/teams to show in the dashboard",
	});
	help.style.opacity = "0.7";
	help.style.fontSize = "12px";

	if (!ctx.orgStructurePort) {
		root.createEl("em", { text: "Organization data unavailable." });
		return;
	}

	const { organizations, teams } = ctx.orgStructurePort.getOrgStructure();

	const allowed = ctx.getAllowedTeamSlugsForSelectedUser(); // null => unknown; do not filter
	const predicate = allowed
		? (slug: string) => allowed.has((slug || "").toLowerCase())
		: (_slug: string) => true;

	const filteredOrgs: OrganizationNode[] = (organizations || []).filter(
		(org) => {
			const slugs = collectOrgTeamSlugs(org);
			return slugs.some((s) => predicate(s));
		}
	);

	const independentsRaw = (teams || []).filter(
		(t) => (t.subteams?.length ?? 0) === 0
	);
	const independents = independentsRaw.filter((t) => {
		const slug = extractPossibleSlug(t);
		return slug && predicate(slug);
	});

	const hasOrgs = filteredOrgs.length > 0;
	const hasIndependents = independents.length > 0;

	if (!hasOrgs && !hasIndependents) {
		root.createEl("em", { text: "No organizations or teams available." });
		return;
	}

	if (hasOrgs) {
		renderAccordion(
			root,
			"Organizations",
			() => {
				const wrapper = document.createElement("div");
				wrapper.style.display = "flex";
				wrapper.style.flexDirection = "column";
				wrapper.style.gap = "6px";

				for (const org of filteredOrgs) {
					const orgEl = renderOrganizationEntryFiltered(
						ctx,
						org,
						predicate
					);
					if (orgEl) wrapper.appendChild(orgEl);
				}
				return wrapper;
			},
			true
		);
	}

	if (hasIndependents) {
		renderAccordion(
			root,
			"Teams",
			() => {
				const wrapper = document.createElement("div");
				wrapper.style.display = "flex";
				wrapper.style.flexDirection = "column";
				wrapper.style.gap = "6px";

				for (const t of independents) {
					const row = document.createElement("div");
					row.style.display = "flex";
					row.style.alignItems = "center";
					row.style.gap = "6px";

					const cb = document.createElement("input");
					cb.type = "checkbox";
					const slug = extractPossibleSlug(t);
					cb.checked = isSlugSelected(ctx, slug);

					cb.addEventListener("change", () => {
						if (!slug) return;
						ctx.setImplicitAllSelected(false);
						if (cb.checked) ctx.addSelectedSlugs([slug]);
						else ctx.removeSelectedSlugs([slug]);
						ctx.onSelectionChanged();
					});

					const label = document.createElement("label");
					const name = extractPossibleName(t);
					label.textContent = `${name} (${extractPossibleSlug(t)})`;
					label.style.cursor = "pointer";
					label.addEventListener("click", () => cb.click());

					row.appendChild(cb);
					row.appendChild(label);
					wrapper.appendChild(row);
				}

				return wrapper;
			},
			true
		);
	}
}

function renderAccordion(
	parent: HTMLElement,
	title: string,
	contentBuilder: () => HTMLElement,
	defaultOpen = false
) {
	const section = parent.createEl("div", {
		attr: {
			style: "border-top:1px solid var(--background-modifier-border); padding-top:8px; margin-top:8px;",
		},
	});

	const hdr = section.createEl("div", {
		attr: {
			style: "display:flex; align-items:center; gap:8px; cursor:pointer; user-select:none;",
		},
	});
	const chev = hdr.createEl("span", { text: defaultOpen ? "▾" : "▸" });
	hdr.createEl("span", {
		text: title,
		attr: { style: "font-weight:600;" },
	});

	const content = contentBuilder();
	content.style.display = defaultOpen ? "block" : "none";
	section.appendChild(content);

	hdr.addEventListener("click", () => {
		const open = content.style.display !== "none";
		content.style.display = open ? "none" : "block";
		chev.textContent = open ? "▸" : "▾";
	});
}

function renderOrganizationEntryFiltered(
	ctx: TeamsPopupContext,
	org: OrganizationNode,
	isAllowed: (slug: string) => boolean
): HTMLElement | null {
	// Collect only allowed team slugs in this org (so group-level checkbox matches visible subset)
	const allOrgTeamSlugs = collectOrgTeamSlugs(org).filter(isAllowed);
	if (allOrgTeamSlugs.length === 0) {
		return null;
	}

	const container = document.createElement("div");
	container.style.display = "flex";
	container.style.flexDirection = "column";
	container.style.gap = "4px";

	const row = document.createElement("div");
	row.style.display = "flex";
	row.style.alignItems = "center";
	row.style.gap = "6px";

	const cb = document.createElement("input");
	cb.type = "checkbox";

	const state = computeSelectionState(ctx, allOrgTeamSlugs);
	cb.checked = state === "all";
	(cb as unknown as { indeterminate: boolean }).indeterminate =
		state === "partial";

	cb.addEventListener("change", () => {
		ctx.setImplicitAllSelected(false);
		if (cb.checked) ctx.addSelectedSlugs(allOrgTeamSlugs);
		else ctx.removeSelectedSlugs(allOrgTeamSlugs);
		ctx.onSelectionChanged();
	});

	const label = document.createElement("label");
	label.textContent = `${extractPossibleName(org)} (${extractPossibleSlug(
		org
	)})`;
	label.style.cursor = "pointer";
	label.addEventListener("click", () => cb.click());

	const expandBtn = document.createElement("button");
	expandBtn.type = "button";
	expandBtn.textContent = "▸";
	expandBtn.style.border = "none";
	expandBtn.style.background = "none";
	expandBtn.style.cursor = "pointer";
	expandBtn.style.fontSize = "12px";
	expandBtn.title = "Show teams";

	row.appendChild(cb);
	row.appendChild(label);
	row.appendChild(expandBtn);

	const nested = document.createElement("div");
	nested.style.display = "none";
	nested.style.marginLeft = "18px";
	nested.style.marginTop = "4px";

	expandBtn.addEventListener("click", () => {
		const open = nested.style.display !== "none";
		nested.style.display = open ? "none" : "block";
		expandBtn.textContent = open ? "▸" : "▾";
	});

	for (const team of org.teams || []) {
		const tEl = renderTeamNodeEntryFiltered(ctx, team, 0, isAllowed);
		if (tEl) nested.appendChild(tEl);
	}

	container.appendChild(row);
	container.appendChild(nested);
	return container;
}

function renderTeamNodeEntryFiltered(
	ctx: TeamsPopupContext,
	node: TeamNode,
	level: number,
	isAllowed: (slug: string) => boolean
): HTMLElement | null {
	const hasChildren = (node.subteams?.length ?? 0) > 0;

	const allSlugsHere = collectTeamNodeSlugs(node);
	if (!allSlugsHere.some(isAllowed)) return null;

	const visibleSlugsHere = allSlugsHere.filter(isAllowed);

	const wrapper = document.createElement("div");
	wrapper.style.display = "flex";
	wrapper.style.flexDirection = "column";
	wrapper.style.gap = "4px";

	const row = document.createElement("div");
	row.style.display = "flex";
	row.style.alignItems = "center";
	row.style.gap = "6px";
	row.style.paddingLeft = `${Math.min(24, level * 12)}px`;

	const cb = document.createElement("input");
	cb.type = "checkbox";

	const state = computeSelectionState(ctx, visibleSlugsHere);
	cb.checked = state === "all";
	(cb as unknown as { indeterminate: boolean }).indeterminate =
		state === "partial";

	cb.addEventListener("change", () => {
		ctx.setImplicitAllSelected(false);
		if (cb.checked) ctx.addSelectedSlugs(visibleSlugsHere);
		else ctx.removeSelectedSlugs(visibleSlugsHere);
		ctx.onSelectionChanged();
	});

	const label = document.createElement("label");
	label.textContent = `${extractPossibleName(node)} (${extractPossibleSlug(
		node
	)})`;
	label.style.cursor = "pointer";
	label.addEventListener("click", () => cb.click());

	row.appendChild(cb);
	row.appendChild(label);

	let nestedChildren: HTMLDivElement | null = null;
	if (hasChildren) {
		const expandBtn = document.createElement("button");
		expandBtn.type = "button";
		expandBtn.textContent = "▸";
		expandBtn.style.border = "none";
		expandBtn.style.background = "none";
		expandBtn.style.cursor = "pointer";
		expandBtn.style.fontSize = "12px";
		expandBtn.title = "Show subteams";
		row.appendChild(expandBtn);

		nestedChildren = document.createElement("div");
		nestedChildren.style.display = "none";
		nestedChildren.style.marginLeft = "18px";
		nestedChildren.style.marginTop = "4px";

		expandBtn.addEventListener("click", () => {
			const open = nestedChildren!.style.display !== "none";
			nestedChildren!.style.display = open ? "none" : "block";
			expandBtn.textContent = open ? "▸" : "▾";
		});
	}

	wrapper.appendChild(row);

	if (hasChildren && nestedChildren) {
		for (const child of node.subteams || []) {
			const childEl = renderTeamNodeEntryFiltered(
				ctx,
				child,
				level + 1,
				isAllowed
			);
			if (childEl) nestedChildren.appendChild(childEl);
		}
		wrapper.appendChild(nestedChildren);
	}

	return wrapper;
}

function isSlugSelected(ctx: TeamsPopupContext, slug: string): boolean {
	if (ctx.implicitAllSelected) return true;
	return ctx.selectedTeamSlugs.has((slug || "").toLowerCase());
}

function computeSelectionState(
	ctx: TeamsPopupContext,
	slugs: string[]
): "all" | "none" | "partial" {
	if (ctx.implicitAllSelected) return "all";
	let selected = 0;
	for (const s of slugs) {
		if (ctx.selectedTeamSlugs.has(s.toLowerCase())) selected++;
	}
	if (selected === 0) return "none";
	if (selected === slugs.length) return "all";
	return "partial";
}

function collectTeamNodeSlugs(node: TeamNode): string[] {
	const slugs: string[] = [];
	const visit = (n: TeamNode) => {
		const s = extractPossibleSlug(n);
		if (s) slugs.push(s);
		for (const c of n.subteams || []) visit(c);
	};
	visit(node);
	return slugs;
}

function collectOrgTeamSlugs(org: OrganizationNode): string[] {
	const slugs: string[] = [];
	for (const t of org.teams || []) {
		slugs.push(...collectTeamNodeSlugs(t));
	}
	return Array.from(new Set(slugs));
}

function extractPossibleSlug(obj: unknown): string {
	if (!obj || typeof obj !== "object") return "";
	const anyObj = obj as Record<string, unknown>;
	const cand =
		anyObj.slug ??
		anyObj.teamSlug ??
		anyObj.id ??
		anyObj.key ??
		anyObj.code;
	return typeof cand === "string"
		? cand.toLowerCase().trim()
		: String(cand || "")
			.toLowerCase()
			.trim();
}

function extractPossibleName(obj: unknown): string {
	if (!obj || typeof obj !== "object") return "";
	const anyObj = obj as Record<string, unknown>;
	const cand =
		anyObj.name ?? anyObj.teamName ?? anyObj.displayName ?? anyObj.title;
	return typeof cand === "string" ? cand : "";
}
