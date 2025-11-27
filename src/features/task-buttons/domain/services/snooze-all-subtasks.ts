import type { TaskItem } from "@features/task-index";
import type { FileRepository, TaskWithMetadata } from "../types";
import { normalizeVisibleText, sanitizeUserSlug } from "../utils/text";
import { parseYyyyMmDd } from "@features/task-date-manager";
import { getTaskFilePath, guessTaskLineIndex } from "../utils/task";
import { escapeRegExp } from "@utils";

/**
 * Update a single task line to include or replace inherited snooze marker for a specific user.
 * Returns the updated line string.
 */
function updateLineWithSnoozeAllMarker(
	line: string,
	userSlug: string,
	dateStr: string,
	today: Date
): string {
	const safeUser = sanitizeUserSlug(userSlug);
	const userSpan = `<span style="display: none">${safeUser}</span>`;

	// Remove duplicates of user-specific inherited markers
	const userMarkerRegex = new RegExp(
		String.raw`💤⬇️\s*<span[^>]*>\s*${escapeRegExp(
			safeUser
		)}\s*<\/span>\s*(\d{4}-\d{2}-\d{2})?`,
		"g"
	);

	// Global inherited marker (not user-specific)
	const globalInheritedRegex = /💤⬇️\s*(\d{4}-\d{2}-\d{2})(?!\s*<span)/g;

	let out = line.replace(userMarkerRegex, "").trimEnd();

	// If a global inherited snooze exists but is expired, replace with user-specific
	out = out.replace(globalInheritedRegex, (match: string, date: string) => {
		const d = parseYyyyMmDd(date);
		if (d && d.getTime() > today.getTime()) return match;
		return `💤⬇️${userSpan} ${dateStr}`;
	});

	if (!/\s$/.test(out)) out += " ";
	out += `💤⬇️${userSpan} ${dateStr}`;
	return out;
}

/**
 * Given a TaskItem and a target date, find the corresponding line in the file
 * and update it with a user-specific snooze-all marker.
 */
export async function snoozeAllSubtasks(
	task: TaskItem,
	fileRepo: FileRepository,
	userSlug: string,
	dateStr: string,
	today: Date
): Promise<void> {
	const filePath = getTaskFilePath(task);
	if (!filePath) throw new Error("Missing file path for task");

	const content = await fileRepo.readFile(filePath);
	const lines = content.split(/\r?\n/);

	const getLineRestNormalized = (line: string): string | null => {
		const m = line.match(/^\s*[-*]\s*\[\s*.\s*\]\s*(.*)$/);
		return m ? normalizeVisibleText(m[1]) : null;
	};

	const taskWithMeta = task as TaskWithMetadata;
	const targetTextSource = (task.text ?? taskWithMeta.visual ?? "").trim();
	const targetTextNorm = normalizeVisibleText(targetTextSource);

	// Attempt matching around the guessed line for robustness
	const baseIdx = guessTaskLineIndex(task);
	const candidates = [baseIdx, baseIdx - 1, baseIdx + 1].filter(
		(i) => i >= 0 && i < lines.length
	);

	let targetLineIndex = -1;

	for (const i of candidates) {
		const rest = getLineRestNormalized(lines[i]);
		if (!rest) continue;
		if (
			rest === targetTextNorm ||
			rest.startsWith(targetTextNorm) ||
			targetTextNorm.startsWith(rest)
		) {
			targetLineIndex = i;
			break;
		}
	}

	if (targetLineIndex === -1 && targetTextNorm) {
		for (let i = 0; i < lines.length; i++) {
			const rest = getLineRestNormalized(lines[i]);
			if (rest && rest === targetTextNorm) {
				targetLineIndex = i;
				break;
			}
		}
		if (targetLineIndex === -1) {
			for (let i = 0; i < lines.length; i++) {
				const rest = getLineRestNormalized(lines[i]);
				if (rest && rest.startsWith(targetTextNorm)) {
					targetLineIndex = i;
					break;
				}
			}
		}
	}

	if (targetLineIndex < 0) {
		throw new Error("Unable to locate task line for snooze-all");
	}

	const updated = updateLineWithSnoozeAllMarker(
		lines[targetLineIndex],
		userSlug,
		dateStr,
		today
	);
	if (updated !== lines[targetLineIndex]) {
		lines[targetLineIndex] = updated;
		const newContent = lines.join("\n");
		if (newContent !== content) {
			await fileRepo.writeFile(filePath, newContent);
		}
	}
}