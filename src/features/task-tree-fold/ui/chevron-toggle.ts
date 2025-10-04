import type { App } from "obsidian";
import type { TaskItem } from "@features/task-index";
import { buildPrunedMergedTrees } from "@features/task-tree-builder";
import { getFilteredSortedDirectChildren } from "../domain/utils";
import { animateClose, animateOpen } from "./animations";
import { selectChildrenUl, getAncestorWraps } from "./dom-utils";

/**
 * Lifecycle-aware event registration. Use Obsidian's registerDomEvent underneath.
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
 * Attach a set of chevrons to direct LI children of a UL.
 * Expands filtered/sorted direct children upon toggle.
 */
export function attachChevronSet(
	ul: HTMLElement,
	deps: SectionFoldingDeps,
	options: { childrenType?: string; sectionName: string }
) {
	const {
		childrenMap,
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

	const lis = Array.from(
		ul.querySelectorAll(":scope > li[data-task-uid]")
	) as HTMLElement[];

	lis.forEach((liEl) => {
		const uid = liEl.getAttribute("data-task-uid") || "";
		if (!uid) return;

		const checkbox = liEl.querySelector(
			'input[type="checkbox"]'
		) as HTMLInputElement | null;

		// Remove any stale toggles (generalized from "epic" to "fold")
		liEl.querySelectorAll(
			'span[data-fold-toggle="true"], span[data-fold-toggle-hit="true"]'
		).forEach((n) => n.remove());

		const filteredChildren = getFilteredSortedDirectChildren(
			uid,
			childrenMap,
			options.childrenType
		);
		if (filteredChildren.length === 0) {
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

		// Position hitbox left of the checkbox
		const gapPx = 6;
		const positionToggle = () => {
			if (!checkbox || !hit.isConnected) return;
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

		const expand = () => {
			if (liEl.getAttribute("data-children-expanded") === "true") return;

			const children = getFilteredSortedDirectChildren(
				uid,
				childrenMap,
				options.childrenType
			);
			if (children.length === 0) return;

			// Build top-only list
			const topOnly = buildPrunedMergedTrees(
				children,
				deps.taskMap,
				undefined,
				deps.childrenMap,
				{
					depth: 0,
				}
			);

			// Render into a temporary fragment
			const tmp = document.createElement("div");
			renderTaskTree(
				topOnly,
				tmp,
				app,
				1,
				false,
				"children",
				selectedAlias
			);

			// Pick the expected UL
			const expectedSet = new Set(
				children.map((c) => c._uniqueId).filter((x): x is string => !!x)
			);
			let generated = tmp.querySelector(
				"ul.agile-dashboard.contains-task-list"
			) as HTMLElement | null;
			if (!generated) return;
			generated = selectChildrenUl(generated, expectedSet);

			// Wrap and animate open
			const wrap = document.createElement("div");
			wrap.className = "agile-children-collapse";
			wrap.setAttribute("data-children-wrap-for", uid);
			wrap.style.overflow = "hidden";
			wrap.appendChild(generated);
			liEl.appendChild(wrap);

			const ancestorWraps = getAncestorWraps(liEl);
			animateOpen(wrap, ancestorWraps);

			// Attach next level chevrons (no type gating at deeper levels)
			attachChevronSet(generated, deps, {
				childrenType: undefined,
				sectionName: options.sectionName,
			});

			chevron.style.transform = "rotate(90deg)";
			liEl.setAttribute("data-children-expanded", "true");
			hit.setAttribute("aria-expanded", "true");
		};

		const collapse = () => {
			const wrap = liEl.querySelector(
				`:scope > div.agile-children-collapse[data-children-wrap-for="${uid}"]`
			) as HTMLElement | null;

			if (!wrap) {
				chevron.style.transform = "rotate(0deg)";
				liEl.setAttribute("data-children-expanded", "false");
				hit.setAttribute("aria-expanded", "false");
				return;
			}

			const ancestorWraps = getAncestorWraps(liEl);
			animateClose(wrap, ancestorWraps, () => {
				wrap.remove();
				chevron.style.transform = "rotate(0deg)";
				liEl.setAttribute("data-children-expanded", "false");
				hit.setAttribute("aria-expanded", "false");
			});
		};

		const toggle = () => {
			const expanded =
				liEl.getAttribute("data-children-expanded") === "true";
			expanded ? collapse() : expand();
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
	});
}
