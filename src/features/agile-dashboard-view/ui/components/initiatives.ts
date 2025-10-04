import { App } from "obsidian";
import { TaskItem, TaskParams } from "@features/task-index";
import { renderTaskTree } from "./task-renderer";
import {
	activeForMember,
	isCancelled,
	isCompleted,
	getAgileArtifactType,
} from "@features/task-filter";
import { buildPrunedMergedTrees } from "@features/task-tree-builder";
import { isShownByParams } from "../utils/filters";

/**
 * Process and render the Initiatives section.
 * Displays top-level initiatives. Expanding an initiative shows only its direct epics.
 * Each expanded level renders ONLY direct children (filtered) and adds recursive chevrons.
 */
export function processAndRenderInitiatives(
	container: HTMLElement,
	currentTasks: TaskItem[],
	status: boolean,
	selectedAlias: string | null,
	app: App,
	taskMap: Map<string, TaskItem>,
	childrenMap: Map<string, TaskItem[]>,
	taskParams: TaskParams
) {
	// 1) Filter to tasks shown by current view toggles
	const sectionTasks = currentTasks.filter((task) =>
		isShownByParams(task, taskMap, selectedAlias, taskParams)
	);

	// 2) Only initiatives assigned/active for member
	const directlyAssigned = sectionTasks.filter(
		(task) =>
			activeForMember(task, status, selectedAlias) &&
			getAgileArtifactType(task) === "initiative"
	);

	// Sorting helper (used at every depth)
	const group = (t: TaskItem) =>
		t.status === " " ? 0 : t.status === "/" ? 1 : 2;
	const lineOf = (t: TaskItem) =>
		t.position?.start?.line ?? Number.MAX_SAFE_INTEGER;
	const sortTasks = (arr: TaskItem[]) =>
		arr.slice().sort((a, b) => {
			const ga = group(a);
			const gb = group(b);
			if (ga !== gb) return ga - gb;
			return lineOf(a) - lineOf(b);
		});

	// Return direct filtered children for a parent uid.
	// If allowedType is provided (e.g., "epic"), only include that type.
	function getFilteredSortedDirectChildren(
		uid: string,
		allowedType?: "epic"
	): TaskItem[] {
		const direct = childrenMap.get(uid) || [];
		let items = allowedType
			? direct.filter((c) => getAgileArtifactType(c) === allowedType)
			: direct;
		items = items.filter((c) => !isCompleted(c) && !isCancelled(c));
		return sortTasks(items);
	}

	// Render ONLY the given tasks (no descendants) as a UL
	function renderTopOnlyList(
		items: TaskItem[],
		section: string
	): HTMLElement | null {
		if (items.length === 0) return null;
		const topOnly = buildPrunedMergedTrees(
			items,
			taskMap,
			undefined,
			childrenMap,
			{ depth: 0 }
		);
		const tmp = document.createElement("div");
		renderTaskTree(topOnly, tmp, app, 1, false, section, selectedAlias);
		return tmp.querySelector("ul.agile-dashboard.contains-task-list");
	}

	// Helpers to analyze/unwrap ULs
	function directChildLisOfUl(ul: HTMLElement): HTMLElement[] {
		return Array.from(ul.children).filter(
			(el): el is HTMLElement =>
				el instanceof HTMLElement && el.tagName.toLowerCase() === "li"
		);
	}

	// Try to pick a UL whose direct LIs exactly match the expected children UIDs.
	function selectChildrenUl(
		generated: HTMLElement,
		expectedUIDs: Set<string>
	): HTMLElement {
		const isMatch = (ul: HTMLElement) => {
			const lis = directChildLisOfUl(ul);
			if (lis.length === 0) return false;
			return lis.every((li) =>
				expectedUIDs.has(li.getAttribute("data-task-uid") || "")
			);
		};

		if (isMatch(generated)) return generated;

		const descendantUls = Array.from(
			generated.querySelectorAll("ul.agile-dashboard.contains-task-list")
		) as HTMLElement[];
		for (const ul of descendantUls) {
			if (isMatch(ul)) return ul;
		}

		let ul: HTMLElement = generated;
		while (true) {
			const lis = directChildLisOfUl(ul);
			if (lis.length !== 1) break;
			const inner = ul.querySelector(
				":scope > li > ul.agile-dashboard.contains-task-list"
			) as HTMLElement | null;
			if (!inner) break;
			ul = inner;
		}
		return ul;
	}

	// Anim helpers
	const prefersReducedMotion = () =>
		typeof window !== "undefined" &&
		(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ??
			false);

	function measureExactAutoHeight(el: HTMLElement): number {
		const prevH = el.style.height;
		const prevT = el.style.transition;
		el.style.transition = "none";
		el.style.height = "auto";
		const h = Math.round(el.getBoundingClientRect().height);
		el.style.height = prevH;
		el.style.transition = prevT;
		return h;
	}

	function cascadeTrackHeightsExact(
		childWrap: HTMLElement,
		ancestors: HTMLElement[],
		childStartPx: number,
		childTargetPx: number
	) {
		if (prefersReducedMotion() || ancestors.length === 0) return;

		const bases = ancestors.map((a) =>
			Math.max(
				0,
				Math.round(a.getBoundingClientRect().height) - childStartPx
			)
		);

		ancestors.forEach((a, i) => {
			a.style.transition = "none";
			a.style.overflow = "hidden";
			a.style.height = `${Math.max(
				0,
				Math.round(bases[i] + childStartPx)
			)}px`;
		});

		void childWrap.offsetHeight;

		requestAnimationFrame(() => {
			ancestors.forEach((a, i) => {
				a.style.transition = "height 180ms ease";
				a.style.height = `${Math.max(0, bases[i] + childTargetPx)}px`;
			});

			const onEnd = (ev: TransitionEvent) => {
				if (ev.propertyName !== "height") return;
				childWrap.removeEventListener("transitionend", onEnd);

				ancestors.forEach((a) => {
					a.style.transition = "";
					a.style.height = "auto";
					a.style.overflow = "";
				});
			};
			childWrap.addEventListener("transitionend", onEnd);
		});
	}

	const animateOpen = (
		wrap: HTMLElement,
		ancestorWraps: HTMLElement[] = []
	) => {
		if (prefersReducedMotion()) {
			wrap.style.height = "auto";
			wrap.style.opacity = "1";
			wrap.style.overflow = "";
			return;
		}

		wrap.style.transition = "none";
		wrap.style.overflow = "hidden";
		wrap.style.opacity = "0";

		const targetPx = measureExactAutoHeight(wrap);
		const startPx = 0;

		wrap.style.height = `${startPx}px`;
		void wrap.offsetHeight;

		cascadeTrackHeightsExact(wrap, ancestorWraps, startPx, targetPx);

		requestAnimationFrame(() => {
			const onEnd = (ev: TransitionEvent) => {
				if (ev.propertyName !== "height") return;
				wrap.removeEventListener("transitionend", onEnd);
				wrap.style.transition = "";
				wrap.style.height = "auto";
				wrap.style.opacity = "1";
				wrap.style.overflow = "";
			};

			wrap.addEventListener("transitionend", onEnd);
			wrap.style.transition = "height 180ms ease, opacity 140ms ease";
			wrap.style.height = `${targetPx}px`;
			wrap.style.opacity = "1";
		});
	};

	const animateClose = (
		wrap: HTMLElement,
		ancestorWraps: HTMLElement[] = [],
		onDone: () => void
	) => {
		if (prefersReducedMotion()) {
			onDone();
			return;
		}

		wrap.style.transition = "none";
		wrap.style.overflow = "hidden";
		wrap.style.opacity = "1";

		const startPx = Math.round(wrap.getBoundingClientRect().height);
		const targetPx = 0;

		wrap.style.height = `${startPx}px`;
		void wrap.offsetHeight;

		cascadeTrackHeightsExact(wrap, ancestorWraps, startPx, targetPx);

		requestAnimationFrame(() => {
			const onEnd = (ev: TransitionEvent) => {
				if (ev.propertyName !== "height") return;
				wrap.removeEventListener("transitionend", onEnd);
				onDone();
			};

			wrap.addEventListener("transitionend", onEnd);
			wrap.style.transition = "height 180ms ease, opacity 140ms ease";
			wrap.style.height = `${targetPx}px`;
			wrap.style.opacity = "0";
		});
	};

	function getAncestorWraps(liEl: HTMLElement): HTMLElement[] {
		const wraps: HTMLElement[] = [];
		let p: HTMLElement | null = liEl.parentElement as HTMLElement | null;
		while (p) {
			if (p.classList?.contains("agile-children-collapse")) {
				wraps.push(p);
			}
			p = p.parentElement as HTMLElement | null;
		}
		return wraps;
	}

	// Build ONLY the initiatives (no children) so epics are hidden by default
	const initiativesOnly = buildPrunedMergedTrees(
		directlyAssigned,
		taskMap,
		undefined,
		childrenMap,
		{ depth: 0 }
	);

	if (initiativesOnly.length > 0) {
		container.createEl("h2", { text: "🎖️ Initiatives" });

		// Render initiatives with no children
		renderTaskTree(
			initiativesOnly,
			container,
			app,
			0,
			false,
			"initiatives",
			selectedAlias
		);

		const attachToggles = () => {
			const lists = Array.from(
				container.querySelectorAll(
					'ul.agile-dashboard.contains-task-list[data-section="initiatives"]'
				)
			) as HTMLElement[];
			if (lists.length === 0) return;
			const initiativesUl = lists[lists.length - 1];

			// Add chevrons to the initiatives UL (each LI toggles direct epics only)
			attachChevronSet(initiativesUl, { childrenType: "epic" });
		};

		function attachChevronSet(
			ul: HTMLElement,
			options: { childrenType?: "epic" }
		) {
			const lis = Array.from(
				ul.querySelectorAll(":scope > li[data-task-uid]")
			) as HTMLElement[];

			lis.forEach((liEl) => {
				const uid = liEl.getAttribute("data-task-uid") || "";
				if (!uid) return;

				const checkbox = liEl.querySelector(
					'input[type="checkbox"]'
				) as HTMLInputElement | null;

				// Remove any existing toggle UI (avoid duplicates on re-renders)
				liEl.querySelectorAll(
					'span[data-epic-toggle="true"], span[data-epic-toggle-hit="true"]'
				).forEach((n) => n.remove());

				const filteredChildren = getFilteredSortedDirectChildren(
					uid,
					options.childrenType
				);
				if (filteredChildren.length === 0) {
					liEl.setAttribute("data-children-expanded", "false");
					return; // No chevron if no filtered children
				}

				// Build visual chevron
				const chevron = document.createElement("span");
				chevron.textContent = ">";
				chevron.setAttribute("data-epic-toggle", "true");
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
				hit.setAttribute("data-epic-toggle-hit", "true");
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
					const left = Math.round(
						cbRect.left - anchorRect.left - gapPx - w
					);
					const top = Math.round(
						cbRect.top - anchorRect.top + (cbRect.height - h) / 2
					);
					hit.style.left = `${left}px`;
					hit.style.top = `${top}px`;
				};
				positionToggle();
				requestAnimationFrame(positionToggle);

				// Reposition on resize/scroll
				const reposition = () => positionToggle();
				window.addEventListener("resize", reposition, {
					passive: true,
				});
				window.addEventListener("scroll", reposition, {
					passive: true,
					capture: true,
				});
				container.addEventListener("scroll", reposition, {
					passive: true,
					capture: true,
				});

				// Clean up listeners if this li is removed
				const mo = new MutationObserver((muts) => {
					for (const m of muts) {
						m.removedNodes.forEach((n) => {
							// @ts-ignore
							if (n === liEl || (n as any).contains?.(liEl)) {
								window.removeEventListener(
									"resize",
									reposition
								);
								window.removeEventListener(
									"scroll",
									reposition,
									{ capture: true } as any
								);
								container.removeEventListener(
									"scroll",
									reposition,
									{ capture: true } as any
								);
								mo.disconnect();
							}
						});
					}
				});
				mo.observe(liEl.parentNode || liEl, {
					childList: true,
					subtree: true,
				});

				const expand = () => {
					if (liEl.getAttribute("data-children-expanded") === "true")
						return;

					const children = getFilteredSortedDirectChildren(
						uid,
						options.childrenType
					);
					if (children.length === 0) return;

					let generated = renderTopOnlyList(children, "children");
					if (!generated) return;

					const expectedSet = new Set(
						children
							.map((c) => c._uniqueId)
							.filter((x): x is string => !!x)
					);
					generated = selectChildrenUl(generated, expectedSet);

					const wrap = document.createElement("div");
					wrap.className = "agile-children-collapse";
					wrap.setAttribute("data-children-wrap-for", uid);
					wrap.style.overflow = "hidden";
					wrap.appendChild(generated);
					liEl.appendChild(wrap);

					const ancestorWraps = getAncestorWraps(liEl);
					animateOpen(wrap, ancestorWraps);

					attachChevronSet(generated, { childrenType: undefined });

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
				hit.addEventListener("pointerdown", suppress, {
					capture: true,
				});
				hit.addEventListener("mousedown", suppress, { capture: true });
				hit.addEventListener("click", (ev) => {
					suppress(ev);
					toggle();
				});
				hit.addEventListener("keydown", (ev: KeyboardEvent) => {
					if (ev.key === "Enter" || ev.key === " ") {
						suppress(ev);
						toggle();
					}
				});
			});
		}

		try {
			attachToggles();
		} catch {
			/* ignore */
		}
	}
}
