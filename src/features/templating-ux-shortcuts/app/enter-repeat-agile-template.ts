/**
 * UX Shortcuts orchestration: Double-Enter-to-repeat template on next task line.
 *
 * Behavior:
 * - First Enter at logical EOL on a line adjacent to an artifact-item-type template:
 *   Do NOT prevent default. Let Obsidian create the next task line. Start a short timer.
 * - Second Enter within the window: prevent default to suppress Obsidian’s outdent on an
 *   empty task line and open the creation modal for the same template. No extra newline.
 * - If no second Enter arrives within the window: timer clears, and any future Enter
 *   behaves completely normally (no suppression).
 */

import type { App } from "obsidian";
import { MarkdownView, Notice } from "obsidian";
import { getCursorContext } from "@platform/obsidian/";
import {
	insertTemplateAtCursor,
	findTemplateById,
} from "@features/templating-engine";

import {
	requestTemplateParams,
	showSchemaModal,
	showJsonModal,
	type ParamsTemplatingPorts,
} from "@features/templating-params-editor";

type EnterSession = {
	key: string; // filePath#line#wrapperIdOrKey#offset
	active: boolean;
};
let enterSession: EnterSession | null = null;

// Double-enter settings and per-view state
const DOUBLE_ENTER_WINDOW_MS = 300;

type DoubleEnterState = {
	tid: number;
	startedAt: number;
	filePath: string;
	sourceLineNo: number;
	sourceCh: number;
};
const pendingState = new WeakMap<MarkdownView, DoubleEnterState>();

function clearDoubleEnterState(view: MarkdownView, expectedTid?: number) {
	const st = pendingState.get(view);
	if (!st) return;
	if (expectedTid != null && st.tid !== expectedTid) return; // stale
	try {
		clearTimeout(st.tid);
	} catch {}
	pendingState.delete(view);
}

// Helpers: task detection and “empty task line” detection for eligibility
function isTaskLine(line: string): boolean {
	// Optional indent, list marker (- * + or 1. / 1), space(s), then [any single non-]] char]
	return /^\s*(?:[-*+]|\d+[.)])\s+\[[^\]]\](?:\s+|$)/.test(
		line.replace(/\t/g, "    ")
	);
}
function isEmptyTaskLine(line: string): boolean {
	const expanded = line.replace(/\t/g, "    ");
	const m = expanded.match(/^\s*(?:[-*+]|\d+[.)])\s+\[[^\]]\]\s*(.*)$/);
	if (!m) return false;
	const rest = m[1] ?? "";
	return rest.trim().length === 0;
}

function collectWrappers(s: string): Array<{
	templateKey: string;
	orderTag: string | null;
	wrapperId: string | null;
	start: number;
	end: number;
}> {
	const out: Array<{
		templateKey: string;
		orderTag: string | null;
		wrapperId: string | null;
		start: number;
		end: number;
	}> = [];
	if (!s) return out;

	const spanOpenRe = /<span\b[^>]*>/gi;
	let m: RegExpExecArray | null;
	const lower = s.toLowerCase();

	while ((m = spanOpenRe.exec(s)) !== null) {
		const openIdx = m.index;
		const gt = s.indexOf(">", openIdx);
		if (gt === -1) break;

		let depth = 1;
		let i = gt + 1;
		let closeEnd = -1;
		while (i < s.length) {
			const nextOpen = lower.indexOf("<span", i);
			const nextClose = lower.indexOf("</span>", i);

			if (nextClose === -1) break;

			if (nextOpen !== -1 && nextOpen < nextClose) {
				const gtn = s.indexOf(">", nextOpen);
				if (gtn === -1) break;
				depth += 1;
				i = gtn + 1;
				continue;
			}

			depth -= 1;
			const endPos = nextClose + "</span>".length;
			if (depth === 0) {
				closeEnd = endPos;
				break;
			}
			i = endPos;
		}
		if (closeEnd === -1) continue;

		const block = s.slice(openIdx, closeEnd);

		const keyMatch = block.match(/\bdata-template-key\s*=\s*"([^"]+)"/i);
		if (!keyMatch) continue;

		const orderMatch = block.match(/\bdata-order-tag\s*=\s*"([^"]+)"/i);
		const idMatch = block.match(/\bdata-template-wrapper\s*=\s*"([^"]+)"/i);

		out.push({
			templateKey: keyMatch[1],
			orderTag: orderMatch ? orderMatch[1] : null,
			wrapperId: idMatch ? idMatch[1] : null,
			start: openIdx,
			end: closeEnd,
		});
	}
	return out;
}

function pickArtifactItemTypeRightMost(s: string) {
	const all = collectWrappers(s);
	if (all.length === 0) return null;
	const candidates = all.filter(
		(w) => (w.orderTag ?? "") === "artifact-item-type"
	);
	if (candidates.length === 0) return null;
	candidates.sort((a, b) => a.start - b.start);
	return candidates[candidates.length - 1];
}

async function openTemplateModalFromContext(
	app: App,
	view: MarkdownView
): Promise<void> {
	const editor = view.editor;
	const ctx = await getCursorContext(app, view, editor);

	const filePath = ctx.filePath ?? "";
	const curLineNo = ctx.lineNumber;
	const prevLineNo = curLineNo - 1;

	const safeGetLine = (n: number) => {
		if (n < 0) return "";
		try {
			return editor.getLine(n) ?? "";
		} catch {
			return "";
		}
	};

	const prevLine = safeGetLine(prevLineNo);
	const curLine = safeGetLine(curLineNo);

	const prevFound = pickArtifactItemTypeRightMost(prevLine);
	const curFound = pickArtifactItemTypeRightMost(curLine);
	const found = prevFound ?? curFound;
	if (!found?.templateKey) return;

	const causeKey = `${filePath}#${prevFound ? prevLineNo : curLineNo}#${
		found.wrapperId ?? found.templateKey
	}#${found.start}`;
	if (enterSession?.active && enterSession.key === causeKey) {
		return;
	}

	const def = findTemplateById(found.templateKey) as any;
	if (!def || !def.hasParams) return;
	if (def.hiddenFromDynamicCommands) return;

	const schema = def.paramsSchema
		? {
				...def.paramsSchema,
				fields:
					def.paramsSchema.fields?.map((f: any) => ({ ...f })) ?? [],
		  }
		: undefined;
	if (!schema) return;

	enterSession = { key: causeKey, active: true };

	try {
		const ports: ParamsTemplatingPorts = {
			findTemplateById: (tid) => findTemplateById(tid) as any,
			showSchemaModal: (tid, sch, isEdit) =>
				showSchemaModal(app, tid, sch as any, isEdit) as Promise<
					Record<string, unknown> | undefined
				>,
			showJsonModal: (tid, initialJson) =>
				showJsonModal(app, tid, initialJson) as Promise<
					Record<string, unknown> | undefined
				>,
		};

		const params = await requestTemplateParams(
			ports,
			found.templateKey,
			{}, // create flow
			false,
			undefined
		);
		if (!params) return;

		insertTemplateAtCursor(
			found.templateKey,
			editor as any,
			filePath,
			params as Record<string, unknown> | undefined
		);
	} finally {
		enterSession = null;
	}
}

/**
 * Main entry for the Enter key. Called on keydown.
 * - First eligible Enter: DO NOT prevent default; start the double-enter window bound to the source line and file.
 * - Second eligible Enter within window at sourceLine+1 on an empty task line: prevent default and open the modal.
 * - Any other Enter while a timer exists: treat as a new first press (reset window), no suppression.
 */
export async function processEnter(
	app: App,
	view: MarkdownView,
	evt: KeyboardEvent
): Promise<void> {
	try {
		if (evt.key !== "Enter") return;

		const editor = view.editor;
		const ctx = await getCursorContext(app, view, editor);

		// Only consider when caret is at logical EOL (no trailing content)
		const lineText = ctx.lineText ?? editor.getLine(ctx.lineNumber) ?? "";
		const afterCursor = lineText.slice(ctx.column ?? 0);
		const cursorAtLogicalEOL = /^\s*$/.test(afterCursor);
		if (!cursorAtLogicalEOL) {
			// Let default behavior proceed
			return;
		}

		// Only proceed when an artifact-item-type wrapper is on current or previous line
		const prevLine = ctx.prevLineText ?? "";
		const curLine = lineText;
		const prevFound = pickArtifactItemTypeRightMost(prevLine);
		const curFound = pickArtifactItemTypeRightMost(curLine);
		const haveArtifact = !!(prevFound ?? curFound);
		if (!haveArtifact) {
			return; // not our scenario
		}

		// Prefer to handle task lines (indent-sensitive)
		const handleOnTask = isTaskLine(curLine) || isTaskLine(prevLine);
		if (!handleOnTask) {
			return; // outside list task context; let default happen
		}

		const now = Date.now();
		const st = pendingState.get(view);

		// If a window is active, decide if this is the valid second press
		if (
			st &&
			now - st.startedAt <= DOUBLE_ENTER_WINDOW_MS &&
			ctx.filePath === st.filePath
		) {
			const isNextLine = ctx.lineNumber === st.sourceLineNo + 1;
			const onEmptyTask = isEmptyTaskLine(curLine);

			if (isNextLine && onEmptyTask) {
				// Valid second press: suppress default/outdent and open modal
				evt.preventDefault();
				evt.stopPropagation();
				clearDoubleEnterState(view); // clears timer and state
				await openTemplateModalFromContext(app, view);
				return;
			} else {
				// Not a valid second press (moved, different position, or not empty task).
				// Treat this as a new first press: reset previous window and start over.
				clearDoubleEnterState(view);
				const tid = window.setTimeout(() => {
					clearDoubleEnterState(view, tid);
				}, DOUBLE_ENTER_WINDOW_MS);
				pendingState.set(view, {
					tid,
					startedAt: now,
					filePath: ctx.filePath,
					sourceLineNo: ctx.lineNumber,
					sourceCh: ctx.column ?? 0,
				});
				// Do NOT prevent default on this press.
				return;
			}
		}

		// No active or valid window -> initialize first-press window and let default behavior proceed.
		const tid = window.setTimeout(() => {
			clearDoubleEnterState(view, tid);
		}, DOUBLE_ENTER_WINDOW_MS);
		pendingState.set(view, {
			tid,
			startedAt: now,
			filePath: ctx.filePath,
			sourceLineNo: ctx.lineNumber,
			sourceCh: ctx.column ?? 0,
		});
		// No preventDefault on first press.
	} catch (err) {
		console.error(
			"[templating-ux-shortcuts] processEnter (double): error",
			(err as Error)?.message ?? err
		);
		new Notice(
			`Template insert failed: ${String((err as Error)?.message ?? err)}`
		);
	}
}
