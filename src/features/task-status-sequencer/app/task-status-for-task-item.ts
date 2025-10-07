/**
 * App orchestration: advance/set for a task item, preferring active editor if open.
 * Uses platform/obsidian primitives (editor/vault transforms).
 */
import type { App, Editor } from "obsidian";
import { MarkdownView } from "obsidian";
import { publishTaskStatusChanged } from "./events/task-status-events";
import {
	DEFAULT_STATUS_SEQUENCE,
	getNextStatusChar,
	type StatusChar,
} from "../domain/task-status-sequence";
import { getCheckboxStatusChar } from "@platform/obsidian";
import { setCheckboxStatusChar } from "../domain/task-status-utils";
import { applyLineTransform } from "@platform/obsidian";
import { applyFileLineTransform } from "@platform/obsidian";

/**
 * Advance the task status on a specific editor line using the sequence.
 * Returns the transition details.
 */
export function advanceTaskStatusAtEditorLine(
	editor: Editor,
	line0: number,
	sequence: ReadonlyArray<StatusChar> = DEFAULT_STATUS_SEQUENCE
): { from: string | null; to: StatusChar | null; didChange: boolean } {
	const res = applyLineTransform(editor, line0, (orig) => {
		const from = getCheckboxStatusChar(orig);
		if (from == null) return orig;
		const to = getNextStatusChar(from, sequence);
		return setCheckboxStatusChar(orig, to);
	});
	const from = getCheckboxStatusChar(res.before);
	const to: StatusChar | null =
		from == null ? null : getNextStatusChar(from, sequence);
	return { from, to, didChange: res.didChange };
}

/**
 * Set the task status on a specific editor line to an explicit target char.
 * Returns the transition details.
 */
export function setTaskStatusAtEditorLine(
	editor: Editor,
	line0: number,
	to: StatusChar
): { from: string | null; to: StatusChar; didChange: boolean } {
	const res = applyLineTransform(editor, line0, (orig) => {
		const from = getCheckboxStatusChar(orig);
		if (from == null) return orig;
		return setCheckboxStatusChar(orig, to);
	});
	const from = getCheckboxStatusChar(res.before);
	return { from, to, didChange: res.didChange };
}

export async function advanceTaskStatusForTaskItem(params: {
	app: App;
	task: {
		filePath: string;
		line0: number;
		status?: string | null | undefined;
	};
	sequence?: ReadonlyArray<StatusChar>;
}): Promise<void> {
	const { app, task, sequence = DEFAULT_STATUS_SEQUENCE } = params;
	const { filePath, line0 } = task;
	if (!filePath || typeof line0 !== "number") return;

	const view = app.workspace.getActiveViewOfType(MarkdownView);
	const editor: Editor | null =
		view && view.file?.path === filePath
			? ((view as any).editor as Editor)
			: null;

	if (editor) {
		const from = getCheckboxStatusChar(editor.getLine(line0) ?? "");
		if (from == null) return;
		const to = getNextStatusChar(
			task.status != null ? task.status : from,
			sequence
		);
		const res = advanceTaskStatusAtEditorLine(editor, line0, sequence);
		if (res.didChange) {
			publishTaskStatusChanged({
				filePath,
				id: "",
				line0,
				fromStatus: from,
				toStatus: to,
			});
		}
		return;
	}

	// Path-based mutation via platform vault primitive
	const vaultRes = await applyFileLineTransform(
		app,
		filePath,
		line0,
		(orig) => {
			const f = getCheckboxStatusChar(orig);
			if (f == null) return orig;
			const t = getNextStatusChar(f, sequence);
			return setCheckboxStatusChar(orig, t);
		}
	);
	const fromPath = getCheckboxStatusChar(vaultRes.before);
	const toPath =
		fromPath == null ? null : getNextStatusChar(fromPath, sequence);
	if (vaultRes.didChange) {
		publishTaskStatusChanged({
			filePath,
			id: "",
			line0,
			fromStatus: fromPath,
			toStatus: toPath ?? undefined,
		});
	}
}

export async function setTaskStatusForTaskItem(params: {
	app: App;
	task: { filePath: string; line0: number };
	to: StatusChar;
}): Promise<void> {
	const { app, task, to } = params;
	const { filePath, line0 } = task;
	if (!filePath || typeof line0 !== "number") return;

	const view = app.workspace.getActiveViewOfType(MarkdownView);
	const editor: Editor | null =
		view && view.file?.path === filePath
			? ((view as any).editor as Editor)
			: null;

	if (editor) {
		const res = setTaskStatusAtEditorLine(editor, line0, to);
		if (res.from == null) return;
		publishTaskStatusChanged({
			filePath,
			id: "",
			line0,
			fromStatus: res.from,
			toStatus: res.to,
		});
		return;
	}

	const vaultRes = await applyFileLineTransform(
		app,
		filePath,
		line0,
		(orig) => {
			const f = getCheckboxStatusChar(orig);
			if (f == null) return orig;
			return setCheckboxStatusChar(orig, to);
		}
	);
	const fromPath = getCheckboxStatusChar(vaultRes.before);
	if (fromPath == null) return;
	if (vaultRes.didChange) {
		publishTaskStatusChanged({
			filePath,
			id: "",
			line0,
			fromStatus: fromPath,
			toStatus: to,
		});
	}
}
