/**
 * Domain ports and core types for task close cascade.
 * These interfaces decouple domain logic from Obsidian/platform details.
 */

export type CloseIntent = "complete" | "cancel";

/**
 * Minimal, line-oriented editing abstraction.
 * Implementations can wrap an Obsidian editor or an in-memory buffer.
 */
export interface EditorPort {
	lineCount(): number;
	getLine(n: number): string;
	setLine(n: number, text: string): void;
	getAllLines(): string[];
	setAllLines(lines: string[]): void;
}

/**
 * File system operations used by headless flows.
 */
export interface VaultPort {
	readFile(path: string): Promise<string>;
	writeFile(path: string, content: string): Promise<void>;
}

/**
 * List and task classification helpers abstracted out of platform code.
 */
export interface LineClassifierPort {
	isListLine(text: string): boolean;
	isTaskLine(text: string): boolean;
	indentWidth(text: string): number;
	getCheckboxStatusChar(text: string): string | null;
	setCheckboxStatusChar(text: string, statusChar: "x" | "-"): string;
}

/**
 * Token and text transforms for completion/cancellation markers and dates.
 */
export interface TokenOpsPort {
	COMPLETED_EMOJI: string;
	CANCELLED_EMOJI: string;
	ISO_DATE_RE: RegExp;
	hasEmoji(text: string, emoji: string): boolean;
	appendEmojiWithDate(text: string, emoji: string, date?: string): string;
	removeEmoji(text: string, emoji: string): string;
}

/**
 * Simple prompting port, implemented by a DOM dialog by default.
 */
export interface PromptPort {
	askCascadeConfirm(): Promise<boolean>;
}

/**
 * Transition detected between two snapshots on a given line.
 */
export type ClosedTransition = {
	line0: number;
	intent: CloseIntent;
};

/**
 * Configure suppression and prompting windows.
 */
export type CascadePolicy = {
	promptDedupMs: number;
	writeSuppressMs: number;
};

/**
 * Event bus abstraction for optional optimistic change announcements.
 */
export interface EventBusPort {
	dispatchPrepareOptimisticFileChange(filePath: string): void;
}
