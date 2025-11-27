import {
	injectCheckboxStyles,
	removeCheckboxStyles,
} from "@styles/custom-checkboxes";
import type { Container } from "./container";

/** Applies/removes checkbox styles based on settings. */
export function applyCheckboxStylesSetting(container: Container): void {
	// Defensive sanitize for scope (already sanitized manifestId in container).
	const scopeId = container.manifestId;
	const enabled = !!container.settings?.useBundledCheckboxes;
	if (enabled) {
		injectCheckboxStyles(scopeId);
	} else {
		removeCheckboxStyles(scopeId);
	}
}

/** Registers style application on load and ensures removal on unload. */
export function registerStyles(container: Container): void {
	applyCheckboxStylesSetting(container);
	container.plugin.register(() => {
		removeCheckboxStyles(container.manifestId);
	});
}
