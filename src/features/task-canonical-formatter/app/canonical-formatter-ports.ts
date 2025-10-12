/**
 * Abstraction to integrate with the host/editor.
 * Contains methods to read/replace lines, whole-file operations,
 * progress notifications, and event subscriptions.
 */
export type CanonicalFormatterPort = {
	// Provides current line content and the absolute cursor offset within that line.
	// selection is optional; if omitted, we assume caret at end of the line.
	getCurrentLine: () => {
		line: string;
		lineNumber: number;
		selection?: { start: number; end: number };
	} | null;

	// Retrieve arbitrary line content by its number (no selection context).
	getLineAt?: (lineNumber: number) => string | null;

	// Replace the line and set the new selection (caret or range) within that line.
	replaceLineWithSelection?: (
		lineNumber: number,
		newLine: string,
		newSelection: { start: number; end: number }
	) => void;

	// Simple replacement (if selection cannot be set by host)
	replaceLine?: (lineNumber: number, newLine: string) => void;

	// Optional: Efficient whole-file replacement if host supports it
	replaceAllLines?: (newLines: string[]) => void;

	// Return the current cursor's line number if available
	getCursorLine?: () => number | null;

	// Optional: Provide all lines for file-scope formatting
	getAllLines?: () => string[];

	// Optional: UI progress hooks for long operations
	// Called once when a long operation starts.
	onProgressStart?: (payload: { title: string; total: number }) => void;
	// Called repeatedly with current progress.
	onProgressUpdate?: (payload: {
		current: number;
		total: number;
		message?: string;
	}) => void;
	// Called once when a long operation ends.
	onProgressEnd?: (payload?: { message?: string }) => void;

	// Event hooks from the host/editor — the orchestrator will subscribe to these.
	// Implement these to call the callback when:
	// - onLineCommitted: user presses Enter, or a line edit is “committed”.
	// - onCursorLineChanged: the caret moves to a different line (report prev and next).
	// - onLeafOrFileChanged: file switches, pane/leaf changes, etc.
	onLineCommitted?: (cb: () => void) => () => void; // returns unsubscribe
	onCursorLineChanged?: (
		cb: (e: { prevLine: number; nextLine: number }) => void
	) => () => void; // returns unsubscribe
	onLeafOrFileChanged?: (cb: () => void) => () => void; // returns unsubscribe
};
