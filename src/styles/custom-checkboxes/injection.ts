/* Utilities to toggle the plugin's checkbox CSS at runtime.
 *
 * This module:
 * - Injects the checkbox CSS into a <style> element in <head> on first use.
 * - Uses the data-agile-checkbox-styles attribute on <body> as a feature flag.
 */

import { createLogger } from "@composition/logging";
import checkboxCss from "./checkboxes.css";

const CHECKBOX_STYLES_ATTR = "data-agile-checkbox-styles";
const STYLE_ELEMENT_ATTR = "data-agile-checkbox-styles-source";
const STYLE_ELEMENT_ATTR_VALUE = "agile-obsidian-checkboxes";

const log = createLogger("checkbox-styles");

// Keep a module-scoped reference so we don't create duplicate <style> elements.
let styleElement: HTMLStyleElement | null = null;

function ensureCheckboxStyleElement(): void {
	try {
		const doc = globalThis.document;
		if (!doc) {
			return;
		}

		// Reuse existing element if it already exists (e.g. after plugin reload).
		if (!styleElement || !styleElement.isConnected) {
			const existing = doc.head.querySelector<HTMLStyleElement>(
				`style[${STYLE_ELEMENT_ATTR}="${STYLE_ELEMENT_ATTR_VALUE}"]`
			);

			if (existing) {
				styleElement = existing;

				// In dev / hot-reload, make sure CSS is up to date.
				if (styleElement.textContent !== checkboxCss) {
					styleElement.textContent = checkboxCss;
				}

			} else {
				const el = doc.createElement("style");
				el.setAttribute(STYLE_ELEMENT_ATTR, STYLE_ELEMENT_ATTR_VALUE);
				el.textContent = checkboxCss;
				doc.head.appendChild(el);
				styleElement = el;

			}
		}
	} catch (e) {
		log.error("ensureCheckboxStyleElement: failed", e);
	}
}

/**
 * Marks the document body so that custom checkbox styles become active.
 * Also ensures the checkbox CSS has been injected into the document.
 */
export function injectCheckboxStyles(manifestId: string): void {
	try {
		ensureCheckboxStyleElement();

		const body = globalThis.document?.body ?? null;
		if (!body) {
			return;
		}

		body.setAttribute(CHECKBOX_STYLES_ATTR, manifestId);
	} catch (e) {
		log.error("injectCheckboxStyles: failed", e);
	}
}

/**
 * Clears the marker attribute from the document body when it matches
 * the given manifestId, effectively disabling the custom checkbox styles.
 *
 * Note: We intentionally leave the <style> element in place; all rules are
 * gated behind the body[data-agile-checkbox-styles] attribute, so once the
 * attribute is removed they have no effect. This keeps toggling cheap.
 */
export function removeCheckboxStyles(manifestId: string): void {
	try {
		const body = globalThis.document?.body ?? null;
		if (!body) {
			return;
		}

		const before = body.getAttribute(CHECKBOX_STYLES_ATTR);

		if (before === manifestId) {
			body.removeAttribute(CHECKBOX_STYLES_ATTR);
		}
	} catch (e) {
		log.error("removeCheckboxStyles: failed", e);
	}
}