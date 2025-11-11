import {
	getCheckboxStatusChar,
	indentWidth,
	isListLine,
	isTaskLine,
	setCheckboxStatusChar,
} from "../editor/editor-context-utils";

/**
 * Structurally compatible with LineClassifierPort (feature-side interface).
 * Lives in platform to keep feature code platform-agnostic.
 */
export class ObsidianLineClassifier {
	isListLine(text: string): boolean {
		return isListLine(text);
	}
	isTaskLine(text: string): boolean {
		return isTaskLine(text);
	}
	indentWidth(text: string): number {
		return indentWidth(text);
	}
	getCheckboxStatusChar(text: string): string | null {
		return getCheckboxStatusChar(text);
	}
	setCheckboxStatusChar(text: string, statusChar: "x" | "-"): string {
		return setCheckboxStatusChar(text, statusChar);
	}
}
