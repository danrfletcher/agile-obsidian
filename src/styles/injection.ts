/* Utilities to inject/remove the plugin's CSS snippets at runtime */

/// <reference types="dom" />
// Import the CSS content as text (relies on your bundler config)
// @ts-ignore
import checkboxCss from "./checkboxes.css";

/**
 * Injects the checkbox styles into the document, first removing any previous
 * style tags we added for this plugin (by manifestId).
 */
export function injectCheckboxStyles(manifestId: string): void {
	try {
		removeCheckboxStyles(manifestId);

		const styleEl = document.createElement("style");
		styleEl.setAttribute("data-agile-checkbox-styles", manifestId);
		styleEl.textContent = checkboxCss;
		document.head.appendChild(styleEl);
	} catch {
		// no-op
	}
}

/**
 * Removes any previously injected checkbox styles for this plugin (by manifestId).
 */
export function removeCheckboxStyles(manifestId: string): void {
	try {
		document
			.querySelectorAll(
				`style[data-agile-checkbox-styles="${manifestId}"]`
			)
			.forEach((el) => el.parentElement?.removeChild(el));
	} catch {
		// no-op
	}
}
