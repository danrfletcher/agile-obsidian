/**
 * Hide a task's LI and collapse empty ancestors/sections afterward.
 */
export function hideTaskAndCollapseAncestors(liEl: HTMLElement): void {
	if (!liEl) return;

	const hide = (el: HTMLElement): void => {
		el.hidden = true;
		el.setAttribute("aria-hidden", "true");
	};

	const isVisible = (el: HTMLElement | null): boolean => {
		if (!el) return false;
		if (el.hidden) return false;
		const cs = globalThis.getComputedStyle(el);
		if (cs.visibility === "hidden" || cs.display === "none") return false;
		return el.offsetParent !== null;
	};

	// Hide the affected task
	hide(liEl);

	// Walk up and collapse single-child ancestors
	let current: HTMLElement | null = liEl;
	while (current) {
		const maybeUl = current.parentElement;
		if (!(maybeUl instanceof HTMLUListElement)) break;
		const ul: HTMLUListElement = maybeUl;

		const maybeParentLi = ul.parentElement;
		if (!(maybeParentLi instanceof HTMLLIElement)) break;
		const parentLi: HTMLLIElement = maybeParentLi;

		const childLis = Array.from(ul.children).filter(
			(node): node is HTMLLIElement => node instanceof HTMLLIElement
		);
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
		while (cur) {
			const parentElement: HTMLElement | null = cur.parentElement;
			if (!parentElement) {
				return null;
			}
			if (parentElement.classList.contains("content-container")) {
				return cur;
			}
			cur = parentElement;
		}
		return null;
	};

	const maybeHideAdjacentHeader = (el: HTMLElement): void => {
		const prev = el.previousElementSibling;
		if (prev instanceof HTMLElement && /^H[1-6]$/.test(prev.tagName)) {
			hide(prev);
		}
	};

	const sectionRoot = findSectionRoot(liEl);
	if (sectionRoot) {
		const visibleLis = Array.from(
			sectionRoot.querySelectorAll<HTMLElement>("li")
		).filter((node) => isVisible(node));
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
	const existing = liEl.querySelectorAll<HTMLElement>(selectors.join(", "));
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
	const wrap = globalThis.document.createElement("span");
	wrap.classList.add("agile-snooze-btn-wrap");

	wrap.appendChild(el);

	const firstChildList = liEl.querySelector<HTMLUListElement>(":scope > ul");
	if (firstChildList) {
		liEl.insertBefore(wrap, firstChildList);
	} else {
		liEl.appendChild(wrap);
	}
}