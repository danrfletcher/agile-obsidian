/**
 * Templating orchestrators (wiring-agnostic).
 */

import type { App } from "obsidian";
import type { TemplateDefinition } from "../domain/types";
import {
	insertTemplateAtCursor,
	renderTemplateOnly,
	prefillTemplateParams,
	replaceTemplateWrapperOnCurrentLine,
} from "./templating-service";
import { presetTemplates } from "../domain/presets";
import { getCursorContext } from "@platform/obsidian/";
import { showSchemaModal } from "../ui/template-schema-modal";
import { showJsonModal } from "../ui/template-json-modal";
import { MarkdownView, Notice } from "obsidian";
import type { TaskIndexPort } from "./templating-ports";

type ClickSession = {
	key: string; // filePath#line#wrapperIdOrKey
	active: boolean;
};
let clickSession: ClickSession | null = null;

export async function processClick(app: App, el: HTMLElement): Promise<void> {
	try {
		const templateKey = el.getAttribute("data-template-key") ?? "";
		if (!templateKey) return;
		const [group, key] = templateKey.split(".");
		const groupMap = presetTemplates as unknown as Record<
			string,
			Record<string, TemplateDefinition>
		>;
		const def = groupMap[group]?.[key] as TemplateDefinition | undefined;

		// If this template is excluded from dynamic commands (like members.assignee),
		// do not open parameter modals on click. Let other feature handlers manage it.
		if (def?.hiddenFromDynamicCommands) return;

		if (!def || !def.hasParams) return;

		// Compute a stable click-session key to suppress duplicate modals/handlers
		const instanceId = el.getAttribute("data-template-wrapper") ?? "";
		const view = app.workspace.getActiveViewOfType(MarkdownView) ?? null;
		const editor: any = (view as any)?.editor;
		const filePath = (view?.file?.path ?? "") as string;
		const lineNo =
			typeof editor?.getCursor?.().line === "number"
				? editor.getCursor().line
				: -1;
		const causeKey = `${filePath}#${lineNo}#${instanceId || templateKey}`;

		if (clickSession?.active) {
			// If the same click cause is still active, ignore; otherwise, also ignore to keep one modal at a time.
			if (clickSession.key === causeKey) return;
			return;
		}
		clickSession = { key: causeKey, active: true };

		// Prefill strictly from explicit markers (plus template-specific override)
		const prefill = prefillTemplateParams(templateKey, el) ?? {};
		let params: Record<string, unknown> | undefined;
		if (def.paramsSchema && def.paramsSchema.fields?.length) {
			const schema = {
				...def.paramsSchema,
				fields: def.paramsSchema.fields.map((f) => ({
					...f,
					defaultValue:
						prefill[f.name] != null
							? String(prefill[f.name] ?? "")
							: f.defaultValue,
				})),
			};
			params = await showSchemaModal(app, templateKey, schema, true);
		} else {
			const jsonParams = JSON.stringify(prefill ?? {}, null, 2);
			params = (await showJsonModal(app, templateKey, jsonParams)) as
				| Record<string, unknown>
				| undefined;
		}
		if (!params) return;

		try {
			if (!view || !editor) {
				// Fallback: DOM-only update
				const fresh = renderTemplateOnly(templateKey, params);
				// Preserve original instance id if present
				const iid = instanceId;
				const freshWithSameId = iid
					? fresh.replace(
							/data-template-wrapper="[^"]*"/,
							`data-template-wrapper="${iid}"`
					  )
					: fresh;

				el.outerHTML = freshWithSameId;
				return;
			}

			// Render new HTML and preserve the original instance id
			let newHtml = renderTemplateOnly(templateKey, params);
			if (instanceId) {
				newHtml = newHtml.replace(
					/data-template-wrapper="[^"]*"/,
					`data-template-wrapper="${instanceId}"`
				);
			}

			await replaceTemplateWrapperOnCurrentLine(
				app,
				view,
				editor,
				templateKey,
				newHtml,
				instanceId // <-- pass exact wrapper instance id
			);
		} catch (e) {
			new Notice(
				`Failed to update template: ${String(
					(e as Error)?.message ?? e
				)}`
			);
		}
	} catch (err) {
		new Notice(
			`Template edit failed: ${String((err as Error)?.message ?? err)}`
		);
	} finally {
		// End the click session regardless of outcome
		clickSession = null;
	}
}

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

		// Capture a fresh context after Enter.
		const ctx = await getCursorContext(app, view, editor);

		// Detect if cursor was at end-of-line (ignoring trailing spaces) when Enter occurred.
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

		// Scan a line for ALL wrappers, pick the right-most artifact-item-type
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

				// Deterministic close finder
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

		// If a session is active for the same cause, do nothing.
		if (enterSession?.active && enterSession.key === causeKey) {
			return;
		}

		// Resolve definition quickly; bail if not parameterized or hidden.
		const [g, k] = (found.templateKey ?? "").split(".");
		const defMap = presetTemplates as unknown as Record<
			string,
			Record<string, TemplateDefinition>
		>;
		const def = defMap[g]?.[k] as TemplateDefinition | undefined;
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

		// Start single-shot session BEFORE opening the modal to block re-triggers caused by DOM/editor ripples.
		enterSession = { key: causeKey, active: true };

		try {
			const params = await showSchemaModal(
				app,
				found.templateKey,
				schema,
				false
			);

			if (!params) {
				// Cancelled: end the session and return cleanly.
				return;
			}

			// Insert once. This update will not retrigger the modal because session is still active.
			insertTemplateAtCursor(
				found.templateKey,
				editor as any,
				filePath,
				params as Record<string, unknown> | undefined
			);
		} finally {
			// Session ends after we have either cancelled or inserted.
			// This guarantees no duplicate modal opens for the same Enter press.
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
