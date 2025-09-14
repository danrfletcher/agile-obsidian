import {
	injectCheckboxStyles,
	removeCheckboxStyles,
} from "@styles/custom-checkboxes";
import type { Container } from "./container";

export function applyCheckboxStylesSetting(container: Container) {
	if ((container.settings as any)?.useBundledCheckboxes) {
		injectCheckboxStyles(container.manifestId);
	} else {
		removeCheckboxStyles(container.manifestId);
	}
}

export function registerStyles(container: Container) {
	// Apply current setting
	applyCheckboxStylesSetting(container);
	// Ensure styles are removed on plugin unload
	container.plugin.register(() => removeCheckboxStyles(container.manifestId));
}
