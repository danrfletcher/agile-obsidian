import type { App } from "obsidian";
import type { TaskItem } from "@features/task-index";
import { defaultTaskComparator } from "../domain/utils";
import { animateClose, animateOpen } from "./animations";
import { getAncestorWraps } from "./dom-utils";
import { getAgileArtifactType, isInProgress } from "@features/task-filter";
import { stripListItems } from "@features/task-tree-builder";

/**
Lifecycle-aware event registration. Use Obsidian's registerDomEvent underneath.
*/
export type RegisterDomEvent = (
	el: HTMLElement | Window | Document,
	type: string,
	handler: (evt: any) => void,
	options?: AddEventListenerOptions | boolean
) => void;

interface SectionFoldingDeps {
	app: App;
	taskMap: Map<string, TaskItem>;
	childrenMap: Map<string, TaskItem[]>;
	selectedAlias: string | null;
	renderTaskTree: (
		tasks: TaskItem[],
		container: HTMLElement,
		app: App,
		depth: number,
		isRoot: boolean,
		sectionType: string,
		selectedAlias: string | null
	) => void;
	registerDomEvent?: RegisterDomEvent;
}

/**
 * Session-scoped fold state persistence.
 * Requirements:
 *  - Persist between re-renders and when the dashboard is closed/reopened
 *  - Reset when Obsidian is closed/reopened entirely
 *
 * Implementation: window.sessionStorage
 * Key format: "agile-dashboard:fold-state:v1" -> array<string> of "{section}::{uid}"
 */
const SESSION_STORE_KEY = "agile-dashboard:fold-state:v1";

function safeLoadFoldSet(): Set<string> {
	try {
		const raw = window.sessionStorage?.getItem(SESSION_STORE_KEY);
		if (!raw) return new Set<string>();
		const arr = JSON.parse(raw);
		if (Array.isArray(arr)) {
			return new Set(arr.map((s) => String(s)));
		}
		return new Set<string>();
	} catch {
		return new Set<string>();
	}
}

function safeSaveFoldSet(set: Set<string>): void {
	try {
		const arr = Array.from(set);
		window.sessionStorage?.setItem(SESSION_STORE_KEY, JSON.stringify(arr));
	} catch {
		/* ignore */
	}
}

let foldSetCache: Set<string> | null = null;
function getFoldSet(): Set<string> {
	if (foldSetCache) return foldSetCache;
	foldSetCache = safeLoadFoldSet();
	return foldSetCache;
}

function makeFoldKey(sectionName: string, uid: string): string {
	return `${(sectionName || "").toLowerCase()}::${uid}`;
}

function isExpandedStored(sectionName: string, uid: string): boolean {
	const set = getFoldSet();
	return set.has(makeFoldKey(sectionName, uid));
}

function markExpanded(sectionName: string, uid: string): void {
	const set = getFoldSet();
	set.add(makeFoldKey(sectionName, uid));
	safeSaveFoldSet(set);
}

function unmarkExpanded(sectionName: string, uid: string): void {
	const set = getFoldSet();
	set.delete(makeFoldKey(sectionName, uid));
	safeSaveFoldSet(set);
}

/**
Resolve a TaskItem for a given LI:
- Prefer data-task-uid lookups
- Fallback to file path + line resolution into taskMap
*/
function resolveTaskFromLi(
	liEl: HTMLElement,
	taskMap: Map<string, TaskItem>
): TaskItem | null {
	const uidAttr = liEl.getAttribute("data-task-uid") || "";
	if (uidAttr) {
		const t = taskMap.get(uidAttr);
		if (t) return t;
	}

	const filePath = liEl.getAttribute("data-file-path") || "";
	const lineStr = liEl.getAttribute("data-line") || "";
	const line =
		lineStr && /^\d+$/.test(lineStr) ? parseInt(lineStr, 10) : null;

	if (filePath && line != null) {
		for (const t of taskMap.values()) {
			try {
				const tPath =
					t.link?.path || (t._uniqueId?.split(":")[0] ?? "");
				const tLine =
					typeof (t as any)?.position?.start?.line === "number"
						? (t as any).position.start.line
						: typeof (t as any)?.line === "number"
						? (t as any).line
						: null;
				if (tPath === filePath && tLine === line) return t;
			} catch {
				/* ignore */
			}
		}
	}
	return null;
}

/**
Attach a set of chevrons to direct LI children of a UL.
Expands direct children upon toggle.

Important: We only attach toggles to LIs that do NOT already display a direct child UL.
This ensures we never "fold away" currently visible parts of the task tree,
and only allow additional expansion from bottom-level items.

New: Persist expanded/collapsed state in sessionStorage so it survives:
- re-renders
- closing/reopening dashboard view
But resets when Obsidian is closed and reopened (sessionStorage semantics).

Update: When restoring from persisted state, expand without animation to avoid replaying the unfold animation on re-render.

Change: Only display in-progress children (via isInProgress). If no in-progress children, do not render a chevron.
Also strip list items before rendering unfolded children (via stripListItems).
*/
export function attachChevronSet(
	ul: HTMLElement,
	deps: SectionFoldingDeps,
	options: {
		childrenType?: string;
		sectionName: string;
		/**
		 * Optional override for computing children (e.g., Objectives linked items).
		 */
		getChildren?: (uid: string) => TaskItem[];
	}
) {
	const {
		childrenMap,
		taskMap,
		renderTaskTree,
		app,
		selectedAlias,
		registerDomEvent,
	} = deps;

	const on = (
		el: HTMLElement | Window | Document,
		type: string,
		handler: (evt: any) => void,
		opts?: AddEventListenerOptions | boolean
	) => {
		if (registerDomEvent) {
			registerDomEvent(el, type, handler, opts);
		} else {
			// Fallback if not provided. Prefer providing registerDomEvent from the plugin for lifecycle cleanup.
			el.addEventListener(type, handler as EventListener, opts as any);
		}
	};

	// Consider all direct child LIs, not only those which already expose data-task-uid
	const lis = Array.from(ul.querySelectorAll(":scope > li")) as HTMLElement[];

	lis.forEach((liEl) => {
		// Skip if this LI already displays a direct child UL: we only fold from bottom-level items.
		const hasDirectDisplayedUl = !!liEl.querySelector(
			":scope > ul.agile-dashboard.contains-task-list"
		);
		if (hasDirectDisplayedUl) return;

		// Resolve the associated task and its UID (using fallback path+line resolution)
		const task = resolveTaskFromLi(liEl, taskMap);
		const uid = task?._uniqueId || liEl.getAttribute("data-task-uid") || "";
		if (!task || !uid) {
			// No resolvable task/uid — cannot find children reliably; skip.
			return;
		}

		const checkbox = liEl.querySelector(
			'input[type="checkbox"]'
		) as HTMLInputElement | null;

		// Remove any stale toggles
		liEl.querySelectorAll(
			'span[data-fold-toggle="true"], span[data-fold-toggle-hit="true"]'
		).forEach((n) => n.remove());

		// Compute direct children:
		// - Gate by artifact type when provided for the first level
		// - Filter to in-progress only (via isInProgress)
		// - Deduplicate
		// - Sort via defaultTaskComparator (status buckets then by line)
		const computeChildren = (): TaskItem[] => {
			let raw: TaskItem[] = [];
			if (options.getChildren) {
				raw = options.getChildren(uid) || [];
			} else {
				raw = childrenMap.get(uid) || [];
				if (options.childrenType) {
					raw = raw.filter(
						(c) =>
							(getAgileArtifactType(c) ?? "") ===
							options.childrenType
					);
				}
			}

			// Only in-progress children are eligible to display
			raw = raw.filter((c) => isInProgress(c, taskMap, selectedAlias));

			// Deduplicate:
			// - Prefer _uniqueId when present
			// - Fall back to a stable composite of file path + line + text
			const unique: TaskItem[] = [];
			const seenId = new Set<string>();
			const seenKey = new Set<string>();

			const stableKey = (t: TaskItem): string => {
				const fp = (t.link?.path || "").toLowerCase();
				const line =
					typeof (t as any)?.position?.start?.line === "number"
						? String((t as any).position.start.line)
						: typeof (t as any)?.line === "number"
						? String((t as any).line)
						: "";
				const txt = (t.text || t.visual || "").trim();
				return `${fp}::${line}::${txt}`;
			};

			for (const c of raw) {
				const id = c._uniqueId || "";
				if (id) {
					if (id === uid) continue; // prevent self-loop
					if (seenId.has(id)) continue;
					seenId.add(id);
					unique.push(c);
					continue;
				}
				const key = stableKey(c);
				if (seenKey.has(key)) continue;
				seenKey.add(key);
				unique.push(c);
			}

			// Sort after filtering/deduplication
			return unique.slice().sort(defaultTaskComparator);
		};

		const initialChildren = computeChildren();
		if (initialChildren.length === 0) {
			// No in-progress children => no chevron
			liEl.setAttribute("data-children-expanded", "false");
			return;
		}

		// Build chevron UI
		const chevron = document.createElement("span");
		chevron.textContent = ">";
		chevron.setAttribute("data-fold-toggle", "true");
		chevron.style.display = "inline-block";
		chevron.style.width = "12px";
		chevron.style.height = "12px";
		chevron.style.lineHeight = "12px";
		chevron.style.userSelect = "none";
		chevron.style.transform = "rotate(0deg)";
		chevron.style.transition = "transform 120ms ease";
		chevron.style.pointerEvents = "none";

		// Hitbox inside label to stay aligned
		const hit = document.createElement("span");
		hit.setAttribute("data-fold-toggle-hit", "true");
		hit.setAttribute("role", "button");
		hit.setAttribute("aria-label", "Toggle children");
		hit.setAttribute("aria-expanded", "false");
		hit.tabIndex = 0;

		hit.style.position = "absolute";
		hit.style.display = "flex";
		hit.style.alignItems = "center";
		hit.style.justifyContent = "center";
		hit.style.width = "20px";
		hit.style.height = "20px";
		hit.style.cursor = "pointer";
		hit.style.userSelect = "none";
		hit.style.touchAction = "manipulation";
		(hit.style as any).webkitTapHighlightColor = "transparent";
		hit.style.zIndex = "9999";
		hit.style.pointerEvents = "auto";
		hit.style.background = "transparent";

		let anchorEl: HTMLElement = liEl;
		let labelEl: HTMLElement | null = null;
		if (checkbox) {
			// Try to find the label wrapper around the checkbox; fall back to LI if not present
			labelEl = checkbox.closest("label") as HTMLElement | null;
			if (!labelEl) {
				const alt = checkbox.closest(
					".task-list-item-label, .markdown-preview-view .task-list-item-checkbox + label"
				) as HTMLElement | null;
				if (alt) labelEl = alt;
			}
		}
		if (labelEl) {
			anchorEl = labelEl;
			if (getComputedStyle(anchorEl).position === "static") {
				anchorEl.style.position = "relative";
			}
		} else if (getComputedStyle(liEl).position === "static") {
			liEl.style.position = "relative";
		}

		hit.appendChild(chevron);
		anchorEl.appendChild(hit);

		// Position hitbox left of the checkbox (fallbacks to top-left of anchor if no checkbox)
		const gapPx = 6;
		const positionToggle = () => {
			if (!hit.isConnected) return;
			if (!checkbox) {
				// No checkbox: pin near the start of the anchor
				hit.style.left = `-22px`;
				hit.style.top = `2px`;
				return;
			}
			const anchorRect = anchorEl.getBoundingClientRect();
			const cbRect = checkbox.getBoundingClientRect();
			if (cbRect.width === 0 && cbRect.height === 0) return;
			const w = hit.offsetWidth || 20;
			const h = hit.offsetHeight || 20;
			const left = Math.round(cbRect.left - anchorRect.left - gapPx - w);
			const top = Math.round(
				cbRect.top - anchorRect.top + (cbRect.height - h) / 2
			);
			hit.style.left = `${left}px`;
			hit.style.top = `${top}px`;
		};

		// Initial positioning
		positionToggle();
		requestAnimationFrame(positionToggle);

		// Lifecycle-aware wiring
		on(window, "resize", positionToggle, { passive: true });
		on(window, "scroll", positionToggle, { passive: true, capture: true });
		on(anchorEl, "scroll", positionToggle, {
			passive: true,
			capture: true,
		});

		const expand = (p?: { animate?: boolean }) => {
			const animate = p?.animate !== false; // default true
			if (liEl.getAttribute("data-children-expanded") === "true") return;

			const children = computeChildren();
			if (children.length === 0) return;

			// Strip list items from the tree items to be rendered
			const strippedChildren = stripListItems(children);

			// Render direct children SHALLOWLY after stripping list items
			const shallowChildren = strippedChildren.map((c: TaskItem) => ({
				...c,
				children: [],
			}));

			const tmp = document.createElement("div");
			const sectionForChildren = `${options.sectionName}-children`;
			renderTaskTree(
				shallowChildren,
				tmp,
				app,
				1,
				false,
				sectionForChildren,
				selectedAlias
			);

			// Take the first generated UL directly — it contains the shallow children we passed in.
			const generated = tmp.querySelector(
				"ul.agile-dashboard.contains-task-list"
			) as HTMLElement | null;
			if (!generated) return;

			// Wrap
			const wrap = document.createElement("div");
			wrap.className = "agile-children-collapse";
			wrap.setAttribute("data-children-wrap-for", uid);
			wrap.style.overflow = "hidden";
			wrap.appendChild(generated);
			liEl.appendChild(wrap);

			const applyChevronExpanded = () => {
				const prevTransition = chevron.style.transition;
				if (!animate) chevron.style.transition = "none";
				chevron.style.transform = "rotate(90deg)";
				if (!animate) {
					// Force reflow to apply transform instantly, then restore transition
					void chevron.offsetWidth;
					chevron.style.transition = prevTransition;
				}
			};

			if (animate) {
				const ancestorWraps = getAncestorWraps(liEl);
				animateOpen(wrap, ancestorWraps);
			} else {
				// No animation: show immediately
				wrap.style.height = "auto";
			}

			// Attach next level chevrons (no type gating at deeper levels)
			attachChevronSet(generated, deps, {
				childrenType: undefined,
				sectionName: options.sectionName,
				getChildren: options.getChildren, // allow override deeper too
			});

			applyChevronExpanded();
			liEl.setAttribute("data-children-expanded", "true");
			hit.setAttribute("aria-expanded", "true");

			// Persist expanded state
			markExpanded(options.sectionName, uid);
		};

		const collapse = () => {
			const wrap = liEl.querySelector(
				`:scope > div.agile-children-collapse[data-children-wrap-for="${uid}"]`
			) as HTMLElement | null;

			if (!wrap) {
				chevron.style.transform = "rotate(0deg)";
				liEl.setAttribute("data-children-expanded", "false");
				hit.setAttribute("aria-expanded", "false");
				// Persist collapsed state
				unmarkExpanded(options.sectionName, uid);
				return;
			}

			const ancestorWraps = getAncestorWraps(liEl);
			animateClose(wrap, ancestorWraps, () => {
				wrap.remove();
				chevron.style.transform = "rotate(0deg)";
				liEl.setAttribute("data-children-expanded", "false");
				hit.setAttribute("aria-expanded", "false");
				// Persist collapsed state
				unmarkExpanded(options.sectionName, uid);
			});
		};

		const toggle = () => {
			const expanded =
				liEl.getAttribute("data-children-expanded") === "true";
			expanded ? collapse() : expand({ animate: true });
		};

		const suppress = (ev: Event) => {
			ev.preventDefault();
			ev.stopPropagation();
			// @ts-ignore
			ev.stopImmediatePropagation?.();
		};

		on(hit, "pointerdown", (ev) => suppress(ev), { capture: true });
		on(hit, "mousedown", (ev) => suppress(ev), { capture: true });
		on(hit, "click", (ev) => {
			suppress(ev);
			toggle();
		});
		on(hit as unknown as HTMLElement, "keydown", (ev: any) => {
			const kev = ev as KeyboardEvent;
			if (kev.key === "Enter" || kev.key === " ") {
				suppress(kev);
				toggle();
			}
		});

		// Initialize from persisted state
		const shouldBeExpanded = isExpandedStored(options.sectionName, uid);
		if (shouldBeExpanded) {
			// Expand without animation when restoring state to avoid replaying unfold animation after re-render.
			expand({ animate: false });
		} else {
			liEl.setAttribute("data-children-expanded", "false");
			chevron.style.transform = "rotate(0deg)";
			hit.setAttribute("aria-expanded", "false");
		}
	});
}
