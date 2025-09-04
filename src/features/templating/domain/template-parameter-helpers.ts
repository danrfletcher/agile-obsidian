import { escapeHtml } from "./template-utils";

// Render helper: wraps a user-editable variable so it’s discoverable by the template modal.
export function wrapVar(name: string, value: unknown): string {
	const val = value == null ? "" : String(value);
	return `<span data-tpl-var="${escapeHtml(String(name))}">${escapeHtml(
		val
	)}</span>`;
}

// Generic extractor: only read params from explicit [data-tpl-var] markers.
export function extractParamsFromWrapperEl(
	wrapperEl: HTMLElement
): Record<string, string> {
	const out: Record<string, string> = {};
	const nodes = wrapperEl.querySelectorAll<HTMLElement>("[data-tpl-var]");
	nodes.forEach((el) => {
		const name = el.dataset.tplVar;
		if (!name) return;
		const text = el.textContent?.trim() ?? "";
		out[name] = text;
	});
	return out;
}
