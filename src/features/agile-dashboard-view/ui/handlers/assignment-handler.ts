/**
 * Dashboard-level click delegation for assignment template wrappers.
 * Opens the headless reassignment menu where users click the assignee chip in the dashboard.
 *
 * Feature served: Reassignment UX inside the rendered dashboard without navigating to source.
 */

import type { App } from "obsidian";
import type { OrgStructurePort } from "@features/org-structure";
import { openAssignmentMenuAt } from "@features/task-assignment/ui/reassignment-menu";

type RegisterDomEvent = (
	el: HTMLElement | Window | Document,
	type: string,
	handler: (evt: Event) => void,
	options?: AddEventListenerOptions | boolean
) => void;

export interface AssignmentHandlerOptions {
	app: App;
	orgStructurePort?: OrgStructurePort;
	viewContainer: HTMLElement; // the content area (this.containerEl.children[1])
	registerDomEvent: RegisterDomEvent; // ItemView.registerDomEvent binder for cleanup
}

export function attachDashboardAssignmentHandler(
	opts: AssignmentHandlerOptions
): void {
	const { app, orgStructurePort, viewContainer, registerDomEvent } = opts;
	if (!orgStructurePort) return;

	const handleOpenMenu = (evt: MouseEvent) => {
		try {
			const tgt = evt.target;
			if (!(tgt instanceof HTMLElement)) return;

			// Intercept clicks on the rendered assignee wrapper
			const spanEl = tgt.closest(
				'span[data-template-key="members.assignee"]'
			);
			if (!(spanEl instanceof HTMLElement)) return;
			const span = spanEl;

			// Prevent default navigation/handlers early
			evt.preventDefault();
			evt.stopPropagation();
			evt.stopImmediatePropagation();

			const templateKey = span.getAttribute("data-template-key") ?? "";
			if (templateKey !== "members.assignee") return;

			const instanceId = span.getAttribute("data-template-wrapper") ?? "";
			// AssignType defaults to "assignee" if missing or unknown
			const assignTypeAttr = (
				span.getAttribute("data-assign-type") || ""
			).toLowerCase();
			const assignType: "assignee" | "delegate" =
				assignTypeAttr === "delegate" ? "delegate" : "assignee";

			const currentState = (
				(
					span.getAttribute("data-assignment-state") || ""
				).toLowerCase() === "inactive"
					? "inactive"
					: "active"
			);

			const currentSlug = (
				span.getAttribute("data-member-slug") || ""
			).trim();

			// Map to task LI and resolve file path + optional hints
			const li =
				span.closest("li[data-file-path]") ||
				span.closest("[data-file-path]"); // fallback if structure changes
			if (!(li instanceof HTMLElement)) return;
			const liEl = li;
			const filePath = liEl.getAttribute("data-file-path") || "";
			if (!filePath) return;

			const parentUid = liEl.getAttribute("data-task-uid") || null;
			const lineHintStr = liEl.getAttribute("data-line") || "";
			const lineHint0 =
				lineHintStr && /^\d+$/.test(lineHintStr)
					? parseInt(lineHintStr, 10)
					: null;

			openAssignmentMenuAt({
				mode: "headless",
				app,
				plugin: null,
				ports: { orgStructure: orgStructurePort },
				at: { x: evt.clientX, y: evt.clientY },
				filePath,
				instanceId, // empty string is ok; underlying code will fall back via type/slug/line
				assignType,
				currentState,
				currentSlug,
				parentUid,
				lineHint0,
			});
		} catch {
			/* ignore */
		}
	};

	// Use capture to intercept before Obsidian's default link behaviors (matches templating handler)
	registerDomEvent(viewContainer, "click", handleOpenMenu, { capture: true });

	// Optional: allow right-click to open the reassignment menu as well
	registerDomEvent(
		viewContainer,
		"contextmenu",
		(evt: MouseEvent) => {
			const target = evt.target;
			if (!(target instanceof HTMLElement)) return;
			const spanEl = target.closest(
				'span[data-template-key="members.assignee"]'
			);
			if (!(spanEl instanceof HTMLElement)) return;
			handleOpenMenu(evt);
		},
		{ capture: true }
	);
}