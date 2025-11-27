/**
 * Animation utilities with reduced motion support and height tracking for nested collapses.
 */

type CssProps = Record<string, string | null | undefined>;

/**
 * Helper to update inline styles while respecting existing style attributes.
 * - Keys may be camelCase (e.g., "lineHeight") or kebab-case (e.g., "line-height").
 * - Values of null/undefined/"" remove the property.
 */
function setCssProps(el: HTMLElement, props: CssProps): void {
	const existing = el.getAttribute("style") ?? "";
	const styleMap = new Map<string, string>();

	// Parse existing style attribute into a map of normalized property name -> "prop: value" string.
	for (const part of existing.split(";")) {
		const trimmed = part.trim();
		if (!trimmed) continue;
		const sepIndex = trimmed.indexOf(":");
		if (sepIndex === -1) continue;
		const name = trimmed.slice(0, sepIndex).trim();
		const value = trimmed.slice(sepIndex + 1).trim();
		if (!name) continue;
		styleMap.set(name.toLowerCase(), `${name}: ${value}`);
	}

	for (const [rawName, rawValue] of Object.entries(props)) {
		const normalizedName = rawName.startsWith("--")
			? rawName
			: rawName.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
		const key = normalizedName.toLowerCase();
		if (rawValue == null || rawValue === "") {
			styleMap.delete(key);
		} else {
			styleMap.set(key, `${normalizedName}: ${rawValue}`);
		}
	}

	const nextStyle = Array.from(styleMap.values()).join("; ");
	if (nextStyle) {
		el.setAttribute("style", nextStyle);
	} else {
		el.removeAttribute("style");
	}
}

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
 * Schedule work for the next animation frame when available.
 * Falls back to synchronous execution when `window` or `requestAnimationFrame`
 * are not available (e.g., in non-DOM test environments).
 */
function onNextFrame(cb: () => void): void {
	if (
		typeof window !== "undefined" &&
		typeof window.requestAnimationFrame === "function"
	) {
		window.requestAnimationFrame(() => cb());
	} else {
		cb();
	}
}

/**
 * Measure the element's "auto" height exactly.
 */
export function measureExactAutoHeight(el: HTMLElement): number {
	const prevH = el.style.height;
	const prevT = el.style.transition;

	setCssProps(el, {
		transition: "none",
		height: "auto",
	});

	const h = Math.round(el.getBoundingClientRect().height);

	setCssProps(el, {
		height: prevH,
		transition: prevT,
	});

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
): void {
	if (prefersReducedMotion() || ancestors.length === 0) return;

	const bases = ancestors.map((a) =>
		Math.max(0, Math.round(a.getBoundingClientRect().height) - childStartPx)
	);

	ancestors.forEach((a, i) => {
		setCssProps(a, {
			transition: "none",
			overflow: "hidden",
			height: `${Math.max(
				0,
				Math.round(bases[i] + childStartPx)
			)}px`,
		});
	});

	// Force style flush
	childWrap.getBoundingClientRect();

	onNextFrame(() => {
		ancestors.forEach((a, i) => {
			setCssProps(a, {
				transition: "height 180ms ease",
				height: `${Math.max(0, bases[i] + childTargetPx)}px`,
			});
		});

		const onEnd = (ev: TransitionEvent) => {
			if (ev.propertyName !== "height") return;
			childWrap.removeEventListener("transitionend", onEnd);
			ancestors.forEach((a) => {
				setCssProps(a, {
					transition: "",
					height: "auto",
					overflow: "",
				});
			});
		};

		childWrap.addEventListener("transitionend", onEnd);
	});
}

export function animateOpen(
	wrap: HTMLElement,
	ancestorWraps: HTMLElement[] = []
): void {
	if (prefersReducedMotion()) {
		setCssProps(wrap, {
			height: "auto",
			opacity: "1",
			overflow: "",
		});
		return;
	}

	setCssProps(wrap, {
		transition: "none",
		overflow: "hidden",
		opacity: "0",
	});

	const targetPx = measureExactAutoHeight(wrap);
	const startPx = 0;

	setCssProps(wrap, { height: `${startPx}px` });
	// Force layout flush
	wrap.getBoundingClientRect();

	cascadeTrackHeightsExact(wrap, ancestorWraps, startPx, targetPx);

	onNextFrame(() => {
		const onEnd = (ev: TransitionEvent) => {
			if (ev.propertyName !== "height") return;
			wrap.removeEventListener("transitionend", onEnd);
			setCssProps(wrap, {
				transition: "",
				height: "auto",
				opacity: "1",
				overflow: "",
			});
		};

		wrap.addEventListener("transitionend", onEnd);
		setCssProps(wrap, {
			transition: "height 180ms ease, opacity 140ms ease",
			height: `${targetPx}px`,
			opacity: "1",
		});
	});
}

export function animateClose(
	wrap: HTMLElement,
	ancestorWraps: HTMLElement[] = [],
	onDone: () => void
): void {
	if (prefersReducedMotion()) {
		onDone();
		return;
	}

	setCssProps(wrap, {
		transition: "none",
		overflow: "hidden",
		opacity: "1",
	});

	const startPx = Math.round(wrap.getBoundingClientRect().height);
	const targetPx = 0;

	setCssProps(wrap, { height: `${startPx}px` });
	// Force layout flush
	wrap.getBoundingClientRect();

	cascadeTrackHeightsExact(wrap, ancestorWraps, startPx, targetPx);

	onNextFrame(() => {
		const onEnd = (ev: TransitionEvent) => {
			if (ev.propertyName !== "height") return;
			wrap.removeEventListener("transitionend", onEnd);
			onDone();
		};

		wrap.addEventListener("transitionend", onEnd);
		setCssProps(wrap, {
			transition: "height 180ms ease, opacity 140ms ease",
			height: `${targetPx}px`,
			opacity: "0",
		});
	});
}