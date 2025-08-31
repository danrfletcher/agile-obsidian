import { App, TFile } from "obsidian";
import { TaskItem } from "../tasks/task-item";
import { escapeRegExp, slugifyName } from "../org-structure/domain/slug-utils";

function isDateExpired(dateStr: string): boolean {
	// Parse YYYY-MM-DD as local date (avoid UTC parsing quirks)
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
	if (!m) return false;
	const year = Number(m[1]);
	const month = Number(m[2]) - 1;
	const day = Number(m[3]);
	const target = new Date(year, month, day); // local
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	// Expired means strictly before today
	return target.getTime() < today.getTime();
}

/**
 * Remove expired snooze tokens for the given user from the lines of the provided tasks' files.
 * Returns a set of file paths that were modified.
 */
export async function cleanupExpiredSnoozes(
	app: App,
	tasks: TaskItem[],
	userName: string
): Promise<Set<string>> {
	const changedPaths = new Set<string>();
	const userSlug = slugifyName(userName);
	if (!userSlug) return changedPaths;

	// Group task line numbers by file path
	const linesByFile = new Map<string, Set<number>>();
	for (const t of tasks as (TaskItem & { _uniqueId?: string })[]) {
		const uid = t._uniqueId;
		if (!uid || typeof t.line !== "number") continue;
		const idx = uid.lastIndexOf(":");
		if (idx <= 0) continue;
		const filePath = uid.slice(0, idx);
		if (!linesByFile.has(filePath)) linesByFile.set(filePath, new Set());
		linesByFile.get(filePath)!.add(t.line);
	}

	// Build pattern to find this user's snooze tokens and capture the date
	const slugEsc = escapeRegExp(userSlug);
	const pattern = new RegExp(
		`\\s*💤<span\\s+style="display:\\s*none">\\s*${slugEsc}\\s*<\\/span>\\s*(\\d{4}-\\d{2}-\\d{2})`,
		"gu"
	);

	for (const [path, lineSet] of linesByFile.entries()) {
		const file = app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) continue;

		const content = await app.vault.read(file);
		const lines = content.split("\n");
		let modified = false;

		for (const lineNo of lineSet) {
			if (lineNo < 0 || lineNo >= lines.length) continue;
			const original = lines[lineNo];

			const updated = original.replace(pattern, (match, date: string) => {
				return isDateExpired(date) ? "" : match;
			});

			if (updated !== original) {
				lines[lineNo] = updated.replace(/[ \t]+$/g, ""); // trim trailing whitespace
				modified = true;
			}
		}

		if (modified) {
			await app.vault.modify(file, lines.join("\n"));
			changedPaths.add(path);
		}
	}

	return changedPaths;
}
