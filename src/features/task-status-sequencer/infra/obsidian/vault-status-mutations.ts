/**
 * Obsidian infra: Vault/file-based mutations.
 */
import type { App, TFile } from "obsidian";
import { TFile as ObsidianTFile } from "obsidian";
import { getCheckboxStatusChar } from "@platform/obsidian";
import { setCheckboxStatusChar } from "../../domain/task-status-utils";
import {
	DEFAULT_STATUS_SEQUENCE,
	getNextStatusChar,
	type StatusChar,
} from "../../domain/task-status-sequence";
import { publishTaskStatusChanged } from "../../app/events/task-status-events";

export async function advanceTaskStatusByFileLine(params: {
	app: App;
	filePath: string;
	line0: number;
	sequence?: ReadonlyArray<StatusChar>;
}): Promise<void> {
	const { app, filePath, line0, sequence = DEFAULT_STATUS_SEQUENCE } = params;

	const abs = app.vault.getAbstractFileByPath(filePath);
	if (!(abs instanceof ObsidianTFile)) return;
	const tfile = abs as TFile;

	const content: string = await app.vault.read(tfile);
	const lines = content.split(/\r?\n/);
	const orig = lines[line0] ?? "";
	const from = getCheckboxStatusChar(orig);
	if (from == null) return;

	const to = getNextStatusChar(from, sequence);
	const updated = setCheckboxStatusChar(orig, to);
	if (updated !== orig) {
		lines[line0] = updated;
		await app.vault.modify(tfile, lines.join("\n"));
	}

	publishTaskStatusChanged({
		filePath,
		id: "",
		line0,
		fromStatus: from,
		toStatus: to,
	});
}

export async function setTaskStatusByFileLine(params: {
	app: App;
	filePath: string;
	line0: number;
	to: StatusChar;
}): Promise<void> {
	const { app, filePath, line0, to } = params;

	const abs = app.vault.getAbstractFileByPath(filePath);
	if (!(abs instanceof ObsidianTFile)) return;
	const tfile = abs as TFile;

	const content: string = await app.vault.read(tfile);
	const lines = content.split(/\r?\n/);
	const orig = lines[line0] ?? "";
	const from = getCheckboxStatusChar(orig);
	if (from == null) return;

	const updated = setCheckboxStatusChar(orig, to);
	if (updated !== orig) {
		lines[line0] = updated;
		await app.vault.modify(tfile, lines.join("\n"));
	}

	publishTaskStatusChanged({
		filePath,
		id: "",
		line0,
		fromStatus: from,
		toStatus: to,
	});
}
