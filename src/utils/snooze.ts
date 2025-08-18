import { App, TFile } from "obsidian";
import { name } from "./config";
import { TaskItem } from "../types/TaskItem";

// Slug used in "active-<slug>" and snooze spans
export function getTeamMemberSlug(): string | null {
	const name = name;
	if (!name || typeof name !== "string") return null;
	return name.trim().toLowerCase().replace(/\s+/g, "-");
}

// Update one exact line in a note to add/replace a snooze marker for the given user
export async function snoozeTask(
	task: TaskItem,
	app: App,
	userSlug: string,
	dateStr?: string
): Promise<void> {
	try {
		const file = app.vault.getAbstractFileByPath(task.link?.path) as TFile;
		if (!file) throw new Error(`File not found: ${task.link?.path}`);

		const raw = await app.vault.read(file);
		const lines = raw.split("\n");
		const idx = Math.max(0, (task.line ?? 1) - 1);

		if (idx >= lines.length) {
			throw new Error(`Line index out of range for ${file.path}: ${idx}`);
		}

		const line = lines[idx];

		// Match "- [ ] " + rest OR "* [x] " + rest etc.
		const m = line.match(/^(\s*[-*]\s*\[\s*.\s*\]\s*)(.*)$/);
		if (!m) {
			// Fallback: no standard task prefix, try text replacement once
			const updated = replaceTextSnooze(
				task.text ?? "",
				raw,
				userSlug,
				dateStr
			);
			if (updated === raw) {
				throw new Error("Could not locate task line to snooze.");
			}
			await app.vault.modify(file, updated);
			return;
		}

		const prefix = m[1];
		const rest = m[2];

		const updatedRest = applySnoozeToText(rest, userSlug, dateStr);
		lines[idx] = `${prefix}${updatedRest}`;

		await app.vault.modify(file, lines.join("\n"));
	} catch (err) {
		console.error("Error snoozing task:", err);
		throw err;
	}
}

// Replace occurrences inside an arbitrary content chunk (fallback path)
function replaceTextSnooze(
	originalText: string,
	content: string,
	userSlug: string,
	dateStr?: string
) {
	const updatedText = applySnoozeToText(originalText, userSlug, dateStr);
	return content.replace(originalText, updatedText);
}

// Core text transformation: remove existing user snoozes, convert expired global snooze, append new user snooze
function applySnoozeToText(
	text: string,
	userSlug: string,
	dateStr?: string
): string {
	const today = new Date();
	today.setHours(0, 0, 0, 0);

	const target =
		dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)
			? dateStr
			: new Date(today.getTime() + 86400000).toISOString().split("T")[0];

	const userSpan = `💤<span style="display: none">${userSlug}</span>`;
	const userSnooze = `${userSpan} ${target}`;

	// Global expired snooze: 💤 YYYY-MM-DD (no <span>)
	const globalSnoozeRegex = /💤\s*(\d{4}-\d{2}-\d{2})(?!\s*<span)/g;

	// User-specific snooze(s): 💤<span ...>slug</span> [date]
	const userSnoozeRegex = new RegExp(
		`💤\\s*<span[^>]*>${escapeRegExp(
			userSlug
		)}<\\/span>\\s*(\\d{4}-\\d{2}-\\d{2})?`,
		"g"
	);

	let out = text;

	// Replace expired global snooze with user-specific
	out = out.replace(globalSnoozeRegex, (match, date) => {
		const d = new Date(date);
		d.setHours(0, 0, 0, 0);
		if (!isNaN(d.getTime()) && d <= today) {
			return userSnooze; // convert expired global snooze to user-specific one
		}
		return match; // keep active global snooze
	});

	// Remove any existing user snoozes for this user (dedupe)
	out = out.replace(userSnoozeRegex, "").trim();

	// Append new user snooze
	if (!/\s$/.test(out)) out += " ";
	out += userSnooze;

	return out;
}

function escapeRegExp(s: string) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
