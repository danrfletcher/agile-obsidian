/**
 * Hide a task's LI and collapse empty ancestors/sections afterward.
 */
export function hideTaskAndCollapseAncestors(liEl: HTMLElement): void {
	if (!liEl) return;

	const hide = (el: HTMLElement) => {
		el.style.display = "none";
		el.setAttribute("aria-hidden", "true");
	};

	const isVisible = (el: HTMLElement) => {
		if (!el) return false;
		if (el.style.display === "none") return false;
		const cs = getComputedStyle(el);
		if (cs.visibility === "hidden" || cs.display === "none") return false;
		return el.offsetParent !== null;
	};

	// Hide the affected task
	hide(liEl);

	// Walk up and collapse single-child ancestors
	let current: HTMLElement | null = liEl;
	while (current) {
		const ul = current.parentElement as HTMLElement | null;
		if (!ul || ul.tagName !== "UL") break;

		const parentLi = ul.parentElement as HTMLElement | null;
		if (!parentLi || parentLi.tagName !== "LI") break;

		const childLis = Array.from(ul.children).filter(
			(n) =>
				n instanceof HTMLElement && (n as HTMLElement).tagName === "LI"
		) as HTMLElement[];
		const visibleChildren = childLis.filter((li) => isVisible(li));

		if (childLis.length === 1 || visibleChildren.length === 0) {
			hide(parentLi);
			current = parentLi;
			continue;
		}
		break;
	}

	// If no visible tasks remain in the section, hide the section (including its header)
	const findSectionRoot = (el: HTMLElement): HTMLElement | null => {
		let cur: HTMLElement | null = el;
		while (cur && cur.parentElement) {
			const parent = cur.parentElement as HTMLElement;
			if (parent.classList?.contains("content-container")) {
				return cur;
			}
			cur = parent;
		}
		return null;
	};

	const maybeHideAdjacentHeader = (el: HTMLElement) => {
		const prev = el.previousElementSibling as HTMLElement | null;
		if (prev && /^H[1-6]$/.test(prev.tagName)) {
			hide(prev);
		}
	};

	const sectionRoot = findSectionRoot(liEl);
	if (sectionRoot) {
		const visibleLis = Array.from(
			sectionRoot.querySelectorAll("li")
		).filter((node) => isVisible(node as HTMLElement));
		if (visibleLis.length === 0) {
			hide(sectionRoot);
			maybeHideAdjacentHeader(sectionRoot);
		}
	}
}

/**
 * Remove existing controls by selector(s).
 */
export function removeExistingControls(
	liEl: HTMLElement,
	selectors: string[]
): void {
	const existing = liEl.querySelectorAll(selectors.join(", "));
	existing.forEach((el) => {
		try {
			el.remove();
		} catch {
			/* ignore */
		}
	});
}

/**
 * Insert a control at the end of the task line (before nested UL if present).
 */
export function placeInlineControlAtLineEnd(
	liEl: HTMLElement,
	el: HTMLElement
): void {
	const wrap = document.createElement("span");
	wrap.classList.add("agile-snooze-btn-wrap");
	wrap.style.display = "inline-block";
	wrap.style.marginLeft = "8px";
	wrap.style.verticalAlign = "baseline";

	wrap.appendChild(el);

	const firstChildList = liEl.querySelector(":scope > ul");
	if (firstChildList) {
		liEl.insertBefore(wrap, firstChildList);
	} else {
		liEl.appendChild(wrap);
	}
}
