import { escapeHtml } from "@utils";

function toSafeParamString(value: unknown): string {
	if (value == null) return "";
	if (typeof value === "string") return value;
	if (
		typeof value === "number" ||
		typeof value === "boolean" ||
		typeof value === "bigint"
	) {
		return String(value);
	}
	if (value instanceof Date) {
		return value.toISOString();
	}
	try {
		const json = JSON.stringify(value);
		return typeof json === "string" ? json : "";
	} catch {
		return "";
	}
}

// Render helper: wraps a user-editable variable so it’s discoverable by the template modal (text content).
export function wrapVar(name: string, value: unknown): string {
	const val = toSafeParamString(value);
	return `<span data-tpl-var="${escapeHtml(String(name))}">${escapeHtml(
		val
	)}</span>`;
}

/**
 * Attribute variable helper.
 * Use inside an opening tag to mark a given attribute as variable-driven WITHOUT breaking HTML.
 *
 * Example:
 *   `<a ${attrVar("href","href", href)} class="internal-link">...</a>`
 * Produces:
 *   `<a href="..." data-tpl-attr-var-href="href" class="internal-link">...</a>`
 *
 * During extraction, we read data-tpl-attr-var-<attrName> to map back to the variable name,
 * and then read the current attribute value (e.g., href) to prefill the modal.
 */
export function attrVar(
	attrName: string,
	varName: string,
	value: unknown
): string {
	const safeAttr = String(attrName).replace(/[^a-zA-Z0-9:_-]/g, "");
	const val = toSafeParamString(value);
	const escapedVal = escapeHtml(val);
	const escapedVar = escapeHtml(String(varName));
	return `${safeAttr}="${escapedVal}" data-tpl-attr-var-${safeAttr}="${escapedVar}"`;
}

// Generic extractor: read params from explicit [data-tpl-var] markers and attribute var markers.
export function extractParamsFromWrapperEl(
	wrapperEl: HTMLElement
): Record<string, string> {
	const out: Record<string, string> = {};

	// 1) Text variables wrapped via <span data-tpl-var="name">value</span>
	const nodes = wrapperEl.querySelectorAll<HTMLElement>("[data-tpl-var]");
	nodes.forEach((el) => {
		const name = el.dataset.tplVar;
		if (!name) return;
		const text = el.textContent?.trim() ?? "";
		out[name] = text;
	});

	// 2) Attribute variables marked via data-tpl-attr-var-<attrName>="varName"
	//    We scan the wrapper and all descendants for these markers.
	const allEls: HTMLElement[] = [
		wrapperEl,
		...Array.from(wrapperEl.querySelectorAll<HTMLElement>("*")),
	];
	for (const el of allEls) {
		for (const attr of Array.from(el.attributes)) {
			const attrName = attr.name;
			if (!attrName.startsWith("data-tpl-attr-var-")) continue;

			const targetAttr = attrName.slice("data-tpl-attr-var-".length);
			const varName = (attr.value || "").trim();
			if (!targetAttr || !varName) continue;

			const currentVal = (el.getAttribute(targetAttr) ?? "").trim();
			out[varName] = currentVal;
		}
	}

	return out;
}