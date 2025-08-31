import type { Container } from "src/composition/container";
import { applyCheckboxStylesSetting } from "src/composition/register-styles";

export function registerCustomCheckboxesSettings(container: Container) {
	return {
		applyCheckboxStyles: async (): Promise<void> => {
			applyCheckboxStylesSetting(container);
		},
	};
}
