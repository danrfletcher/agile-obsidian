import {
	normalizeTaskLine,
	type NormalizeOptions,
} from "../domain/canonical-normalize";
import type { CanonicalFormatterPort } from "./canonical-formatter-ports";
import { computeNewCaretAfterNormalize } from "../domain/caret-mapping";

export type CanonicalFormatterService = {
	normalizeCurrentLine: (opts?: NormalizeOptions) => void;
	normalizeLineNumber: (lineNumber: number, opts?: NormalizeOptions) => void;
	normalizeWholeFile: (lines: string[], opts?: NormalizeOptions) => void;
};

export function createCanonicalFormatterService(
	port: CanonicalFormatterPort
): CanonicalFormatterService {
	// Cooperative yield to keep UI responsive during long operations
	const microYield = () => new Promise<void>((r) => setTimeout(r, 0));

	// Tunables
	const CHUNK_SIZE = 50; // batch size for progress reporting
	const YIELD_EVERY_N_LINES = 50;
	const PROGRESS_SHOW_AFTER_MS = 1000; // only show notice if work exceeds this time
	const PROGRESS_UPDATE_MIN_INTERVAL_MS = 250; // update cadence once visible

	function normalizeSingleLineCore(
		lineNumber: number,
		oldLine: string,
		opts?: NormalizeOptions,
		selection?: { start: number; end: number }
	) {
		// Preserve original indentation (leading whitespace)
		const indentMatch = oldLine.match(/^\s*/);
		const indent = indentMatch ? indentMatch[0] : "";

		// Normalize without indentation, then re-apply it
		const lineSansIndent = oldLine.slice(indent.length);
		const normalizedSansIndent = normalizeTaskLine(
			lineSansIndent,
			opts ?? {}
		);
		const newLine = indent + normalizedSansIndent;

		if (newLine === oldLine) return;

		if (selection && typeof port.replaceLineWithSelection === "function") {
			// Compute desired new selection relative to sans-indent strings,
			// then map back with indent offset.
			const mappedSelSansIndent = computeNewCaretAfterNormalize(
				lineSansIndent,
				normalizedSansIndent,
				{
					start: Math.max(0, selection.start - indent.length),
					end: Math.max(0, selection.end - indent.length),
				}
			);
			const start = mappedSelSansIndent.start + indent.length;
			const end = mappedSelSansIndent.end + indent.length;

			port.replaceLineWithSelection(lineNumber, newLine, { start, end });
		} else if (typeof port.replaceLine === "function") {
			port.replaceLine(lineNumber, newLine);
		}
	}

	return {
		normalizeCurrentLine(opts?: NormalizeOptions) {
			const ctx = port.getCurrentLine();
			if (!ctx) return;
			const { line: oldLine, lineNumber } = ctx;

			// Default selection if host hasn't provided one:
			const fallbackSel = { start: oldLine.length, end: oldLine.length };
			const inputSel = ctx.selection ?? fallbackSel;

			normalizeSingleLineCore(lineNumber, ctx.line, opts, inputSel);
		},

		normalizeLineNumber(lineNumber: number, opts?: NormalizeOptions) {
			if (typeof port.getLineAt !== "function") return;
			const oldLine = port.getLineAt(lineNumber);
			if (oldLine == null) return;
			// No selection mapping when normalizing a non-current line
			normalizeSingleLineCore(lineNumber, oldLine, opts, undefined);
		},

		async normalizeWholeFile(lines: string[], opts?: NormalizeOptions) {
			if (!Array.isArray(lines)) return;

			const total = lines.length;
			if (total === 0) return;

			// Deferred-progress controller: only show after 1s
			const startTs = Date.now();
			let progressVisible = false;
			let lastUpdateTs = 0;
			let progressStarted = false;

			const maybeStartProgress = () => {
				if (progressVisible) return;
				if (Date.now() - startTs >= PROGRESS_SHOW_AFTER_MS) {
					progressVisible = true;
					if (
						!progressStarted &&
						typeof port.onProgressStart === "function"
					) {
						port.onProgressStart({
							title: "Formatting tasks. Please wait…",
							total,
						});
						progressStarted = true;
						lastUpdateTs = 0; // force first update after visible
					}
				}
			};

			const maybeUpdateProgress = (current: number) => {
				if (!progressVisible) return;
				if (typeof port.onProgressUpdate !== "function") return;
				const now = Date.now();
				if (now - lastUpdateTs >= PROGRESS_UPDATE_MIN_INTERVAL_MS) {
					lastUpdateTs = now;
					port.onProgressUpdate({ current, total });
				}
			};

			const endProgress = () => {
				// No final message; just close if we actually started one
				if (!progressStarted) return;
				if (typeof port.onProgressEnd === "function") {
					port.onProgressEnd({});
				}
			};

			let changed = false;
			const out: string[] = new Array(total);

			for (let i = 0; i < total; i++) {
				const oldLine = lines[i] ?? "";

				// Preserve indentation for each line
				const indentMatch = oldLine.match(/^\s*/);
				const indent = indentMatch ? indentMatch[0] : "";
				const lineSansIndent = oldLine.slice(indent.length);
				const normalizedSansIndent = normalizeTaskLine(
					lineSansIndent,
					opts ?? {}
				);
				const newLine = indent + normalizedSansIndent;

				out[i] = newLine;
				if (newLine !== oldLine) changed = true;

				// Progress handling
				if (i % CHUNK_SIZE === 0) {
					maybeStartProgress();
					maybeUpdateProgress(i);
				}
				// Cooperative yielding
				if (i % YIELD_EVERY_N_LINES === 0 && i !== 0) {
					// eslint-disable-next-line no-await-in-loop
					await microYield();
					maybeStartProgress(); // account for elapsed time during yields
				}
			}

			// Final progress update (force to total)
			maybeStartProgress();
			maybeUpdateProgress(total);

			if (!changed) {
				endProgress();
				return;
			}

			// Apply changes
			if (typeof (port as any).replaceAllLines === "function") {
				(port as any).replaceAllLines(out);
			} else {
				for (let i = 0; i < out.length; i++) {
					if (out[i] !== lines[i]) {
						if (typeof port.replaceLine === "function") {
							port.replaceLine(i, out[i]);
						}
					}
					if (i % YIELD_EVERY_N_LINES === 0 && i !== 0) {
						// eslint-disable-next-line no-await-in-loop
						await microYield();
						maybeStartProgress();
						maybeUpdateProgress(Math.min(i + 1, total));
					}
				}
			}

			endProgress();
		},
	} as CanonicalFormatterService;
}
