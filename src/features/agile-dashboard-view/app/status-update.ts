import { App, TFile } from "obsidian";
import { TaskItem } from "@features/task-index";
import { hideTaskAndCollapseAncestors } from "../ui/components/task-buttons";
import { eventBus } from "./event-bus";

/**
 * Toggle or cancel a task's status in the source file and update the UI via events.
 * - Short press toggles between "/" and "x"
 * - Long press cancels to "-"
 *
 * Returns the new status if updated, otherwise null.
 *
 * Notes:
 * - We still suppress the modify-triggered refresh (to avoid double-refresh),
 *   but we now dispatch a post-write event to have the view re-render cleanly.
 */
export const handleStatusChange = async (
	task: TaskItem,
	_liEl: HTMLElement, // no longer used for DOM-hiding
	app: App,
	isCancel = false
): Promise<string | null> => {
	try {
		const filePath = task.link?.path || task._uniqueId?.split(":")[0];
		if (!filePath) throw new Error("Missing task file path");

		const file = app.vault.getAbstractFileByPath(filePath) as TFile;
		if (!file) throw new Error(`File not found: ${filePath}`);

		eventBus.dispatch("agile:prepare-optimistic-file-change", { filePath });

		const content = await app.vault.read(file);
		const lines = content.split(/\r?\n/);

		// Helpers
		const parseStatusFromLine = (line: string): string | null => {
			const m = line.match(/^\s*[-*]\s*\[\s*(.)\s*\]/);
			return m ? m[1] : null;
		};
		const normalize = (s: string) =>
			(s || "")
				.replace(/\s*(✅|❌)\s+\d{4}-\d{2}-\d{2}\b/g, "")
				.replace(/\s+/g, " ")
				.trim();
		const getLineRestNormalized = (line: string): string | null => {
			const m = line.match(/^\s*[-*]\s*\[\s*.\s*\]\s*(.*)$/);
			return m ? normalize(m[1]) : null;
		};

		let effectiveStatus = (task.status ?? " ").trim() || " ";
		let targetLineIndex = -1;

		const targetTextNorm = normalize(
			(task.text || task.visual || "").trim()
		);

		// Candidate indices prefer parsed task position
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

		const newStatus = isCancel ? "-" : effectiveStatus === "/" ? "x" : "/";

		const today = new Date();
		const yyyy = String(today.getFullYear());
		const mm = String(today.getMonth() + 1).padStart(2, "0");
		const dd = String(today.getDate()).padStart(2, "0");
		const dateStr = `${yyyy}-${mm}-${dd}`;

		const updateLine = (line: string): string => {
			const m = line.match(/^(\s*[-*]\s*\[\s*)(.)(\s*\]\s*)(.*)$/);
			if (!m) return line;

			const prefix = m[1];
			const bracketSuffix = m[3];
			let rest = m[4] ?? "";

			// Remove previous completion/cancel markers
			rest = rest
				.replace(/\s*(✅|❌)\s+\d{4}-\d{2}-\d{2}\b/g, "")
				.trimEnd();

			let updated = `${prefix}${newStatus}${bracketSuffix}${
				rest ? " " + rest : ""
			}`;

			if (newStatus === "x") {
				updated += ` ✅ ${dateStr}`;
			} else if (newStatus === "-") {
				updated += ` ❌ ${dateStr}`;
			}

			return updated;
		};

		const tryReplaceAtIndex = (idx: number): string | null => {
			if (idx < 0 || idx >= lines.length) return null;
			const original = lines[idx];
			const replaced = updateLine(original);
			if (replaced !== original) {
				lines[idx] = replaced;
				return lines.join("\n");
			}
			return null;
		};

		let newContent: string | null = null;

		if (targetLineIndex !== -1) {
			newContent = tryReplaceAtIndex(targetLineIndex);
		}

		if (newContent == null) {
			// Exact match scan
			if (targetTextNorm) {
				for (let i = 0; i < lines.length; i++) {
					const m = lines[i].match(/^\s*[-*]\s*\[\s*.\s*\]\s*(.*)$/);
					if (!m) continue;
					if (normalize(m[1]) === targetTextNorm) {
						newContent = tryReplaceAtIndex(i);
						if (newContent) break;
					}
				}
			}
			// Prefix match scan
			if (newContent == null && targetTextNorm) {
				for (let i = 0; i < lines.length; i++) {
					const m = lines[i].match(/^\s*[-*]\s*\[\s*.\s*\]\s*(.*)$/);
					if (!m) continue;
					if (normalize(m[1]).startsWith(targetTextNorm)) {
						newContent = tryReplaceAtIndex(i);
						if (newContent) break;
					}
				}
			}
		}

		// Final fallback: raw regex replace (exact text)
		if (newContent == null) {
			const escaped = (task.text || "")
				.trim()
				.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			if (escaped) {
				const re = new RegExp(
					`^(\\s*[-*]\\s*\\[\\s*).(\\s*\\]\\s*)${escaped}(.*)$`,
					"m"
				);
				newContent = content.replace(re, (match) => updateLine(match));
				if (newContent === content) {
					newContent = null;
				}
			}
		}

		if (!newContent || newContent === content) {
			throw new Error("Unable to update task line");
		}

		await app.vault.modify(file, newContent);
		(task as any).status = newStatus;

		// UI: hide completed/cancelled and collapse ancestors
		if (newStatus === "x" || newStatus === "-") {
			try {
				hideTaskAndCollapseAncestors(liEl);
			} catch {
				/* ignore */
			}
		}

		return newStatus;
	} catch {
		return null;
	}
};
