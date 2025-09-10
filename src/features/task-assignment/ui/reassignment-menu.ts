import type { App, Plugin } from "obsidian";
import { MarkdownView, Notice, Menu } from "obsidian";
import { renderTemplateOnly } from "@features/templating/app/templating-service";
import type {
	OrgStructurePort,
	MemberInfo,
	MembersBuckets,
} from "@features/org-structure";
import { classifyMember } from "@features/org-structure";
import {
	findAssignmentWrappersOnLine,
	removeWrappersOfTypeOnLine,
	replaceWrapperInstanceOnLine,
} from "../app/assignment-inline-utils";

type AssignType = "assignee" | "delegate";

function toTitleCase(s: string) {
	return s.replace(
		/\S+/g,
		(w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
	);
}

function getActiveView(app: App): MarkdownView | null {
	return app.workspace.getActiveViewOfType(MarkdownView) ?? null;
}

function findLineIndexByInstanceId(editor: any, instanceId: string): number {
	try {
		const raw = editor.getValue() ?? "";
		const lines = raw.split(/\r?\n/);
		const needle = `data-template-wrapper="${instanceId}"`;
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].includes(needle)) return i;
		}
	} catch {
		// ignore
	}
	return -1;
}

/**
 * Map org-structure member kind to templating "Members.assignee" memberType.
 */
function mapMemberKindToAssigneeType(
	kind: "member" | "internal-team-member" | "team" | "external"
): "teamMember" | "delegateTeam" | "delegateTeamMember" | "delegateExternal" {
	switch (kind) {
		case "member":
			return "teamMember";
		case "team":
			return "delegateTeam";
		case "internal-team-member":
			return "delegateTeamMember";
		case "external":
			return "delegateExternal";
	}
}

function buildAssignmentTargets(
	members: MemberInfo[],
	_buckets: MembersBuckets
) {
	const out: Array<{
		memberName: string;
		memberSlug: string;
		memberLabel: string;
		memberType:
			| "teamMember"
			| "delegateTeam"
			| "delegateTeamMember"
			| "delegateExternal";
	}> = [];

	for (const m of members) {
		const c = classifyMember(m);
		out.push({
			memberName: m.name?.trim() ?? m.alias?.trim() ?? "",
			memberSlug: (m.alias ?? "").trim(),
			memberLabel: c.label,
			memberType: mapMemberKindToAssigneeType(c.kind),
		});
	}

	return out;
}

function placeCursorEndOfLine(editor: any, lineNo: number, lineText: string) {
	try {
		editor.setCursor?.({ line: lineNo, ch: lineText.length });
	} catch {
		// ignore
	}
}

function updateEditorLine(editor: any, lineNo: number, newText: string) {
	const before = editor.getLine(lineNo) ?? "";
	editor.replaceRange(
		newText,
		{ line: lineNo, ch: 0 },
		{ line: lineNo, ch: before.length }
	);
	placeCursorEndOfLine(editor, lineNo, newText);
}

/**
 * Inserts menu items for all options appropriate to the clicked wrapper.
 */
function buildMenuForAssignment(
	menu: Menu,
	params: {
		assignType: AssignType;
		currentSlug: string;
		currentState: "active" | "inactive";
		instanceId: string;
		filePath: string;
		app: App;
		ports: { orgStructure: OrgStructurePort };
	}
) {
	const {
		assignType,
		currentSlug,
		currentState,
		instanceId,
		filePath,
		app,
		ports,
	} = params;
	const view = getActiveView(app);
	const editor: any = (view as any)?.editor;
	if (!view || !editor) return;

	const { members, buckets, team } =
		ports.orgStructure.getTeamMembersForFile(filePath);
	const targets = buildAssignmentTargets(members, buckets);

	const isAssignee = assignType === "assignee";
	const isDelegate = assignType === "delegate";

	// Remove item
	menu.addItem((i) => {
		i.setTitle(isAssignee ? "Remove Assignee" : "Remove Delegate");
		i.onClick(() => {
			const lineNo = findLineIndexByInstanceId(editor, instanceId);
			if (lineNo < 0) return;
			const before = editor.getLine(lineNo) ?? "";
			// Remove this wrapper instance; keep others (including the other assign type)
			const wrappers = findAssignmentWrappersOnLine(before);
			const target = wrappers.find((w) => w.instanceId === instanceId);
			if (!target) return;
			let updated =
				before.slice(0, target.start) + before.slice(target.end);
			// Normalize spaces
			updated = updated.replace(/ {2,}/g, " ").replace(/\s+$/, " ");
			updateEditorLine(editor, lineNo, updated);
		});
	});

	// Convenience helpers
	const addAssignItem = (
		title: string,
		memberName: string,
		memberSlug: string,
		memberType:
			| "teamMember"
			| "delegateTeam"
			| "delegateTeamMember"
			| "delegateExternal"
			| "special",
		nextState: "active" | "inactive"
	) => {
		menu.addItem((i) => {
			i.setTitle(title);
			i.onClick(() => {
				const lineNo = findLineIndexByInstanceId(editor, instanceId);
				if (lineNo < 0) return;

				// Render the new wrapper HTML (reuse the same instance id for seamless replacement)
				let newHtml = renderTemplateOnly("members.assignee", {
					memberName,
					memberSlug,
					memberType,
					assignmentState: nextState,
				});

				// Preserve original instanceId
				newHtml = newHtml.replace(
					/data-template-wrapper="[^"]*"/,
					`data-template-wrapper="${instanceId}"`
				);

				const before = editor.getLine(lineNo) ?? "";
				// Replace the clicked wrapper with the new one
				let updated = replaceWrapperInstanceOnLine(
					before,
					instanceId,
					newHtml
				);

				// Remove any other wrappers of the same assignType on the same line
				updated = removeWrappersOfTypeOnLine(
					updated,
					assignType,
					instanceId
				);

				// Ensure trailing spacing
				updated = updated.replace(/\s+$/, " ");

				updateEditorLine(editor, lineNo, updated);
			});
		});
	};

	const stateOpposite = currentState === "active" ? "inactive" : "active";

	if (isAssignee) {
		// Everyone option (only if file belongs to a team)
		if (team) {
			if (currentSlug === "everyone") {
				// Only offer opposite state
				addAssignItem(
					`Everyone (${toTitleCase(stateOpposite)})`,
					"Everyone",
					"everyone",
					"special",
					stateOpposite
				);
			} else {
				addAssignItem(
					`Everyone (Active)`,
					"Everyone",
					"everyone",
					"special",
					"active"
				);
				addAssignItem(
					`Everyone (Inactive)`,
					"Everyone",
					"everyone",
					"special",
					"inactive"
				);
			}
		}

		// Team members only (exclude delegates)
		for (const t of targets) {
			if (t.memberType !== "teamMember") continue;
			const display = toTitleCase(t.memberName || t.memberSlug || "");
			if (t.memberSlug.toLowerCase() === currentSlug.toLowerCase()) {
				addAssignItem(
					`${display} (${toTitleCase(stateOpposite)})`,
					display,
					t.memberSlug,
					t.memberType,
					stateOpposite
				);
			} else {
				addAssignItem(
					`${display} (Active)`,
					display,
					t.memberSlug,
					t.memberType,
					"active"
				);
				addAssignItem(
					`${display} (Inactive)`,
					display,
					t.memberSlug,
					t.memberType,
					"inactive"
				);
			}
		}
	}

	if (isDelegate) {
		// Delegates: internal teams, internal team members, external delegates
		const delegateTargets = targets.filter(
			(t) =>
				t.memberType === "delegateTeam" ||
				t.memberType === "delegateTeamMember" ||
				t.memberType === "delegateExternal"
		);

		for (const t of delegateTargets) {
			const display = toTitleCase(t.memberName || t.memberSlug || "");
			const labelWithType = `${display} (${t.memberLabel})`;
			if (t.memberSlug.toLowerCase() === currentSlug.toLowerCase()) {
				addAssignItem(
					`${labelWithType} (${toTitleCase(stateOpposite)})`,
					display,
					t.memberSlug,
					t.memberType,
					stateOpposite
				);
			} else {
				addAssignItem(
					`${labelWithType} (Active)`,
					display,
					t.memberSlug,
					t.memberType,
					"active"
				);
				addAssignItem(
					`${labelWithType} (Inactive)`,
					display,
					t.memberSlug,
					t.memberType,
					"inactive"
				);
			}
		}
	}
}

/**
 * Wire DOM handlers to manage clicks on members.assignee wrappers (assignee / delegate marks).
 * This should be registered similarly to your templating DOM handlers.
 */
export function wireTaskAssignmentDomHandlers(
	app: App,
	view: MarkdownView,
	plugin: Plugin,
	ports: { orgStructure: OrgStructurePort }
) {
	// Resolve content root
	const cmHolder = view as unknown as {
		editor?: { cm?: { contentDOM?: HTMLElement } };
	};
	const cmContent = cmHolder.editor?.cm?.contentDOM;
	const contentRoot = (cmContent ??
		view.containerEl.querySelector(".cm-content")) as HTMLElement | null;
	const targetEl: HTMLElement = contentRoot ?? view.containerEl;

	const onClick = (evt: MouseEvent) => {
		const el = (evt.target as HTMLElement | null)?.closest(
			'span[data-template-key="members.assignee"]'
		) as HTMLElement | null;
		if (!el) return;

		// We handle this click; prevent downstream handlers
		evt.preventDefault();
		evt.stopPropagation();
		// @ts-ignore
		(evt as any).stopImmediatePropagation?.();

		try {
			const templateKey = el.getAttribute("data-template-key") ?? "";
			if (templateKey !== "members.assignee") return;

			// Extract current props from the wrapper
			const instanceId = el.getAttribute("data-template-wrapper") ?? "";
			if (!instanceId) return;

			const assignTypeAttr = (
				el.getAttribute("data-assign-type") || ""
			).toLowerCase();
			const assignType: AssignType =
				assignTypeAttr === "delegate" ? "delegate" : "assignee";

			const currentState = (
				(
					el.getAttribute("data-assignment-state") || ""
				).toLowerCase() === "inactive"
					? "inactive"
					: "active"
			) as "active" | "inactive";

			const currentSlug = (
				el.getAttribute("data-member-slug") || ""
			).trim();

			const viewNow = getActiveView(app);
			if (!viewNow) return;
			const editor: any = (viewNow as any).editor;
			const filePath = viewNow.file?.path ?? "";
			if (!editor || !filePath) return;

			// Build and show menu at click position (FIX: use Menu import, not window.obsidian)
			const menu = new Menu();
			buildMenuForAssignment(menu, {
				assignType,
				currentSlug,
				currentState,
				instanceId,
				filePath,
				app,
				ports,
			});
			// Show the menu
			menu.showAtPosition({ x: evt.clientX, y: evt.clientY });
		} catch (err) {
			new Notice(
				`Assignment menu failed: ${String(
					(err as Error)?.message ?? err
				)}`
			);
		}
	};

	plugin.registerDomEvent(targetEl, "click", onClick, { capture: true });
}
