import { App, TFile } from "obsidian";
import { TaskItem } from "@features/task-index";

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
		const filePath = task.link?.path;
		if (!filePath) throw new Error("Missing task.link.path");

		const file = app.vault.getAbstractFileByPath(filePath) as TFile;
		if (!file) throw new Error(`File not found: ${filePath}`);

		// Suppress the modify-event auto-refresh; we'll trigger our own refresh
		window.dispatchEvent(
			new CustomEvent("agile:prepare-optimistic-file-change", {
				detail: { filePath },
			})
		);

		const content = await app.vault.read(file);
		const lines = content.split(/\r?\n/);

		let effectiveStatus = (task.status ?? " ").trim() || " ";
		let targetLineIndex = -1;

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

		const targetTextNorm = normalize(
			(task.text || task.visual || "").trim()
		);

		const baseIdx = typeof task.line === "number" ? task.line : -1;
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
			for (let i = 0; i < lines.length; i++) {
				const rest = getLineRestNormalized(lines[i]);
				if (rest && rest === targetTextNorm) {
					targetLineIndex = i;
					const parsed = parseStatusFromLine(lines[i]);
					if (parsed) effectiveStatus = parsed;
					break;
				}
			}
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

		let newContent: string | null = null;

		const tryReplaceAtIndex = (idx: number) => {
			if (idx < 0 || idx >= lines.length) return false;
			const originalLine = lines[idx];
			const replaced = updateLine(originalLine);
			if (replaced !== originalLine) {
				lines[idx] = replaced;
				newContent = lines.join("\n");
				return true;
			}
			return false;
		};

		if (targetLineIndex !== -1) {
			tryReplaceAtIndex(targetLineIndex);
		}

		if (newContent == null) {
			const targetText = normalize(
				(task.text || task.visual || "").trim()
			);
			if (targetText) {
				for (let i = 0; i < lines.length; i++) {
					const m = lines[i].match(/^\s*[-*]\s*\[\s*.\s*\]\s*(.*)$/);
					if (!m) continue;
					const rest = normalize(m[1]);
					if (rest === targetText) {
						if (tryReplaceAtIndex(i)) break;
					}
				}
				if (newContent == null) {
					for (let i = 0; i < lines.length; i++) {
						const m = lines[i].match(
							/^\s*[-*]\s*\[\s*.\s*\]\s*(.*)$/
						);
						if (!m) continue;
						const rest = normalize(m[1]);
						if (rest.startsWith(targetText)) {
							if (tryReplaceAtIndex(i)) break;
						}
					}
				}
			}
		}

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

		// Notify the dashboard to do a proper refresh (we suppressed the modify auto-refresh)
		const uid = task._uniqueId ?? "";
		window.dispatchEvent(
			new CustomEvent("agile:task-status-updated", {
				detail: { uid, filePath, newStatus },
			})
		);

		return newStatus;
	} catch {
		return null;
	}
};
