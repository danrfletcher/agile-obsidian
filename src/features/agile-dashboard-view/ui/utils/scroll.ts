export function captureScroll(container: HTMLElement): {
	outer: number;
	inner: number;
} {
	const content = container.querySelector<HTMLElement>(".content-container");
	return {
		outer: container.scrollTop,
		inner: content?.scrollTop ?? 0,
	};
}

export function restoreScroll(
	container: HTMLElement,
	state: { outer: number; inner: number }
): void {
	const content = container.querySelector<HTMLElement>(".content-container");
	container.scrollTop = state.outer ?? 0;
	if (content) {
		content.scrollTop = state.inner ?? 0;
	}
}