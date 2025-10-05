/**
 * Templating orchestrators (wiring-agnostic).
 */

import type { App } from "obsidian";
import type { TemplateDefinition } from "../domain/types";
import { insertTemplateAtCursor, findTemplateById } from "./templating-service";
import { getCursorContext } from "@platform/obsidian/";
import { MarkdownView, Notice } from "obsidian";
import type { TaskIndexPort } from "./templating-ports";

import { showSchemaModal } from "@features/templating-params-editor";
import { showJsonModal } from "@features/templating-params-editor";

// Centralize param collection for create flows
import {
	requestTemplateParams,
	type ParamsTemplatingPorts,
} from "@features/templating-params-editor";

/**
 * Enter handling with a lightweight, single-shot guard:
 * - Only inspects previous/current line for an artifact-item-type template.
 * - Opens at most one modal per physical Enter.
 * - After Insert or Cancel, the session ends; no follow-up reopen until next Enter.
 */
type EnterSession = {
	key: string; // filePath#line#wrapperIdOrKey#offset
	active: boolean;
};
let enterSession: EnterSession | null = null;

export async function processEnter(
	app: App,
	view: MarkdownView,
	_ports: { taskIndex: TaskIndexPort }
): Promise<void> {
	try {
		const editor = view.editor;

		const ctx = await getCursorContext(app, view, editor);

		const lineText = ctx.lineText ?? editor.getLine(ctx.lineNumber) ?? "";
		const afterCursor = lineText.slice(ctx.column ?? 0);
		const cursorAtLogicalEOL = /^\s*$/.test(afterCursor);
		if (!cursorAtLogicalEOL) {
			return;
		}

		const filePath = ctx.filePath;
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

		type Found = {
			templateKey: string;
			orderTag: string | null;
			wrapperId: string | null;
			start: number;
			end: number;
		};

		const collectWrappers = (s: string): Found[] => {
			const out: Found[] = [];
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

				const keyMatch = block.match(
					/\bdata-template-key\s*=\s*"([^"]+)"/i
				);
				if (!keyMatch) continue;

				const orderMatch = block.match(
					/\bdata-order-tag\s*=\s*"([^"]+)"/i
				);
				const idMatch = block.match(
					/\bdata-template-wrapper\s*=\s*"([^"]+)"/i
				);

				out.push({
					templateKey: keyMatch[1],
					orderTag: orderMatch ? orderMatch[1] : null,
					wrapperId: idMatch ? idMatch[1] : null,
					start: openIdx,
					end: closeEnd,
				});
			}
			return out;
		};

		const pickArtifactItemTypeRightMost = (s: string): Found | null => {
			const all = collectWrappers(s);
			if (all.length === 0) return null;
			const candidates = all.filter(
				(w) => (w.orderTag ?? "") === "artifact-item-type"
			);
			if (candidates.length === 0) return null;
			candidates.sort((a, b) => a.start - b.start);
			return candidates[candidates.length - 1];
		};

		const prevFound = pickArtifactItemTypeRightMost(prevLine);
		const curFound = pickArtifactItemTypeRightMost(curLine);
		const found = prevFound ?? curFound;

		if (!found?.templateKey) return;

		const causeKey = `${filePath ?? ""}#${
			prevFound ? prevLineNo : curLineNo
		}#${found.wrapperId ?? found.templateKey}#${found.start}`;

		if (enterSession?.active && enterSession.key === causeKey) {
			return;
		}

		const def = findTemplateById(found.templateKey) as
			| TemplateDefinition
			| undefined;
		if (!def || !def.hasParams) return;
		if (def.hiddenFromDynamicCommands) return;

		const schema = def.paramsSchema
			? {
					...def.paramsSchema,
					fields:
						def.paramsSchema.fields?.map((f) => ({ ...f })) ?? [],
			  }
			: undefined;
		if (!schema) return;

		enterSession = { key: causeKey, active: true };

		try {
			// Delegate parameter flow to templating-params-editor
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
				{}, // create flow => no prefill
				false,
				undefined
			);

			if (!params) {
				return;
			}

			insertTemplateAtCursor(
				found.templateKey,
				editor as any,
				filePath,
				params as Record<string, unknown> | undefined
			);
		} finally {
			enterSession = null;
		}
	} catch (err) {
		console.error(
			"[templating] processEnter: error",
			(err as Error)?.message ?? err
		);
		new Notice(
			`Template insert failed: ${String((err as Error)?.message ?? err)}`
		);
	}
}
