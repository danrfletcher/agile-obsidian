/**
 * DOM helpers for task UL/LI traversal and section querying.
 */

export function directChildLisOfUl(ul: HTMLElement): HTMLElement[] {
	return Array.from(ul.children).filter(
		(el): el is HTMLElement =>
			el instanceof HTMLElement && el.tagName.toLowerCase() === "li"
	);
}

/**
 * Given a generated subtree container, pick the UL whose LI children match the expected set of UIDs.
 */
export function selectChildrenUl(
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

	// If the generated root is already the correct UL
	if (isMatch(generated)) return generated;

	// Try descendants
	const descendantUls = Array.from(
		generated.querySelectorAll("ul.agile-dashboard.contains-task-list")
	) as HTMLElement[];
	for (const ul of descendantUls) {
		if (isMatch(ul)) return ul;
	}

	// Fallback: walk down single-child nesting
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

/**
 * Climb ancestors and collect wrapper elements to track during animations.
 */
export function getAncestorWraps(liEl: HTMLElement): HTMLElement[] {
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

/**
 * Locate the latest initiatives (or other section) UL to attach folding to.
 */
export function findSectionUl(
	container: HTMLElement,
	sectionName: string
): HTMLElement | null {
	const lists = Array.from(
		container.querySelectorAll(
			`ul.agile-dashboard.contains-task-list[data-section="${sectionName}"]`
		)
	) as HTMLElement[];
	if (lists.length === 0) return null;
	return lists[lists.length - 1];
}
