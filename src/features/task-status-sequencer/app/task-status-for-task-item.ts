/**
 * App orchestration: advance/set for a task item, preferring active editor if open.
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
import {
	advanceTaskStatusAtEditorLine,
	setTaskStatusAtEditorLine,
} from "../infra/obsidian/editor-status-mutations";
import {
	advanceTaskStatusByFileLine,
	setTaskStatusByFileLine,
} from "../infra/obsidian/vault-status-mutations";

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

	await advanceTaskStatusByFileLine({ app, filePath, line0, sequence });
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

	await setTaskStatusByFileLine({ app, filePath, line0, to });
}
