import {
	injectCheckboxStyles,
	removeCheckboxStyles,
} from "@styles/custom-checkboxes";
import type { Container } from "./container";

/** Applies/removes checkbox styles based on settings. */
export function applyCheckboxStylesSetting(container: Container) {
	// Defensive sanitize for scope (already sanitized manifestId in container).
	const scopeId = container.manifestId;
	if ((container.settings as any)?.useBundledCheckboxes) {
		injectCheckboxStyles(scopeId);
	} else {
		removeCheckboxStyles(scopeId);
	}
}

/** Registers style application on load and ensures removal on unload. */
export function registerStyles(container: Container) {
	applyCheckboxStylesSetting(container);
	container.plugin.register(() => removeCheckboxStyles(container.manifestId));
}
