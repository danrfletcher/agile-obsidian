/**
 * Animation utilities with reduced motion support and height tracking for nested collapses.
 */

function prefersReducedMotion(): boolean {
	if (typeof window === "undefined") return true;
	try {
		return (
			window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ??
			false
		);
	} catch {
		return true;
	}
}

/**
 * Measure the element's "auto" height exactly.
 */
export function measureExactAutoHeight(el: HTMLElement): number {
	const prevH = el.style.height;
	const prevT = el.style.transition;
	el.style.transition = "none";
	el.style.height = "auto";
	const h = Math.round(el.getBoundingClientRect().height);
	el.style.height = prevH;
	el.style.transition = prevT;
	return h;
}

/**
 * Track parent collapse wrappers' heights to produce smooth nested animations.
 */
export function cascadeTrackHeightsExact(
	childWrap: HTMLElement,
	ancestors: HTMLElement[],
	childStartPx: number,
	childTargetPx: number
) {
	if (prefersReducedMotion() || ancestors.length === 0) return;

	const bases = ancestors.map((a) =>
		Math.max(0, Math.round(a.getBoundingClientRect().height) - childStartPx)
	);

	ancestors.forEach((a, i) => {
		a.style.transition = "none";
		a.style.overflow = "hidden";
		a.style.height = `${Math.max(
			0,
			Math.round(bases[i] + childStartPx)
		)}px`;
	});

	// Force style flush
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

export function animateOpen(
	wrap: HTMLElement,
	ancestorWraps: HTMLElement[] = []
) {
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
}

export function animateClose(
	wrap: HTMLElement,
	ancestorWraps: HTMLElement[] = [],
	onDone: () => void
) {
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
}
