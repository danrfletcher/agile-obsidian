import { App, TFile } from "obsidian";
import { TaskItem } from "@features/task-index";
import { hideTaskAndCollapseAncestors } from "../ui/components/task-buttons";
import { eventBus } from "./event-bus";
import {
	DEFAULT_STATUS_SEQUENCE,
	getNextStatusChar,
	advanceTaskStatusForTaskItem,
} from "@features/task-status-sequencer";

/**
 * Toggle or cancel a task's status by delegating to task-status-sequence.
 * - Short press advances via the default sequence: " " → "/" → "x" → "-" → " "
 * - Long press steps through the sequence until it reaches "-"
 *
 * Returns the new status if updated, otherwise null.
 */
export const handleStatusChange = async (
	task: TaskItem,
	liEl: HTMLElement,
	app: App,
	isCancel = false
): Promise<string | null> => {
	try {
		// Resolve file path
		const filePath = task.link?.path || task._uniqueId?.split(":")[0];
		if (!filePath) throw new Error("Missing task file path");

		const file = app.vault.getAbstractFileByPath(filePath) as TFile;
		if (!file) throw new Error(`File not found: ${filePath}`);

		// Prepare optimistic UI suppression for vault modify refresh
		eventBus.dispatch("agile:prepare-optimistic-file-change", { filePath });

		// Read content to robustly locate the target line
		const content = await app.vault.read(file);
		const lines = content.split(/\r?\n/);

		// Helpers (reuse robust targeting from previous implementation)
		const parseStatusFromLine = (line: string): string | null => {
			const m = line.match(/^\s*[-*+]\s*\[\s*(.)\s*\]/);
			return m ? m[1] : null;
		};
		const normalize = (s: string) =>
			(s || "")
				// strip old ✅/❌ markers in comparison context only (not mutating file)
				.replace(/\s*(✅|❌)\s+\d{4}-\d{2}-\d{2}\b/g, "")
				.replace(/\s+/g, " ")
				.trim();
		const getLineRestNormalized = (line: string): string | null => {
			const m = line.match(/^\s*[-*+]\s*\[\s*.\s*\]\s*(.*)$/);
			return m ? normalize(m[1]) : null;
		};

		// Try to resolve the correct line index using provided task hints + text match
		let effectiveStatus = (task.status ?? " ").trim() || " ";
		let targetLineIndex = -1;

		const targetTextNorm = normalize(
			(task.text || task.visual || "").trim()
		);

		// Prefer parsing from known position or nearby
		const baseIdx =
			typeof (task as any)?.position?.start?.line === "number"
				? (task as any).position.start.line
				: typeof task.line === "number"
				? task.line
				: -1;
		const candidates = [baseIdx, baseIdx - 1, baseIdx + 1].filter(
			(i) => i >= 0 && i < lines.length
		);

		for (const i of candidates) {
			const rest = getLineRestNormalized(lines[i]);
			if (!rest) continue;
			if (
				rest === targetTextNorm ||
				rest.startsWith(targetTextNorm) ||
				targetTextNorm.startsWith(rest)
			) {
				targetLineIndex = i;
				const parsed = parseStatusFromLine(lines[i]);
				if (parsed) effectiveStatus = parsed;
				break;
			}
		}

		// Fallback scans
		if (targetLineIndex === -1 && targetTextNorm) {
			// Exact match anywhere
			for (let i = 0; i < lines.length; i++) {
				const rest = getLineRestNormalized(lines[i]);
				if (rest && rest === targetTextNorm) {
					targetLineIndex = i;
					const parsed = parseStatusFromLine(lines[i]);
					if (parsed) effectiveStatus = parsed;
					break;
				}
			}
			// Prefix match anywhere
			if (targetLineIndex === -1) {
				for (let i = 0; i < lines.length; i++) {
					const rest = getLineRestNormalized(lines[i]);
					if (rest && rest.startsWith(targetTextNorm)) {
						targetLineIndex = i;
						const parsed = parseStatusFromLine(lines[i]);
						if (parsed) effectiveStatus = parsed;
						break;
					}
				}
			}
		}

		if (targetLineIndex === -1) {
			// If we absolutely cannot locate the line, abort (avoid unintended edits)
			throw new Error("Unable to locate task line for status change");
		}

		// Predict the next status for short press, or "-" for long press
		const predictShortNext = (cur: string): string =>
			getNextStatusChar(cur as any, DEFAULT_STATUS_SEQUENCE);

		const targetStatus = isCancel ? "-" : predictShortNext(effectiveStatus);

		// Run the update via task-status-sequence, preferring active editor for immediate UX
		// Helper: perform one-step advance
		const stepOnce = async () => {
			await advanceTaskStatusForTaskItem({
				app,
				task: {
					filePath,
					line0: targetLineIndex,
					status: effectiveStatus,
				},
			});
			// Advance our local tracker too for multi-step logic
			effectiveStatus = predictShortNext(effectiveStatus);
		};

		if (isCancel) {
			// Step through the default sequence until we reach '-'
			// Sequence is known: [" ", "/", "x", "-"]
			const seq = DEFAULT_STATUS_SEQUENCE;
			const curIdx = Math.max(
				0,
				seq.findIndex((c) => c === (effectiveStatus as any))
			);
			const targetIdx = seq.findIndex((c) => c === "-");
			const len = seq.length;
			// If current not found (-1), treat as space at 0
			const start = curIdx < 0 ? 0 : curIdx;
			const steps = (targetIdx - start + len) % len;
			for (let i = 0; i < steps; i++) {
				await stepOnce();
			}
		} else {
			// Single step advance
			await stepOnce();
		}

		// Update the TaskItem's in-memory status for immediate UI hints elsewhere
		(task as any).status = targetStatus;

		// Hide completed/cancelled items immediately in UI
		if (targetStatus === "x" || targetStatus === "-") {
			try {
				hideTaskAndCollapseAncestors(liEl);
			} catch {
				/* ignore */
			}
		}

		return targetStatus;
	} catch {
		return null;
	}
};
