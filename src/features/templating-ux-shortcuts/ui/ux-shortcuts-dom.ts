import type {
	App,
	MarkdownView,
	Plugin,
	Editor,
	EditorPosition,
	Menu,
} from "obsidian";
import { processEnter } from "../app/enter-repeat-agile-template";

/**
 * Internal: Deterministic scanner: starting at the given '<span ...>' opening tag, walk the line
 * and count '<span' vs '</span>' to find the matching closing position.
 * This avoids regex corner cases with nested spans.
 */
function findMatchingSpanEndIndexDeterministic(
	s: string,
	startIdx: number
): number {
	// Sanity: the startIdx must point at an opening '<span'
	if (s.slice(startIdx, startIdx + 5).toLowerCase() !== "<span") {
		const firstOpen = s.toLowerCase().indexOf("<span", startIdx);
		if (firstOpen === -1) return -1;
		startIdx = firstOpen;
	}

	const firstGt = s.indexOf(">", startIdx);
	if (firstGt === -1) return -1;

	let depth = 1;
	let i = firstGt + 1;
	const lower = s.toLowerCase();

	while (i < s.length) {
		const nextOpen = lower.indexOf("<span", i);
		const nextClose = lower.indexOf("</span>", i);

		// No more closing tag: unbalanced
		if (nextClose === -1) return -1;

		// Nested open before close -> go deeper, advance to end of that opening tag
		if (nextOpen !== -1 && nextOpen < nextClose) {
			const gt = s.indexOf(">", nextOpen);
			if (gt === -1) return -1;
			depth += 1;
			i = gt + 1;
			continue;
		}

		// Otherwise we encountered a closing
		depth -= 1;
		const closeEnd = nextClose + "</span>".length;
		if (depth === 0) return closeEnd;
		i = closeEnd;
	}

	return -1;
}

// Robust attribute getter (supports ' or ")
function getAttr(segment: string, attr: string): string | null {
	const re = new RegExp(`\\b${attr}\\s*=\\s*"(.*?)"`, "i");
	let m = re.exec(segment);
	if (m) return m[1] ?? null;
	const re2 = new RegExp(`\\b${attr}\\s*=\\s*'(.*?)'`, "i");
	m = re2.exec(segment);
	return m ? m[1] ?? null : null;
}

type InlineTemplateWrapper = {
	start: number; // index of '<span' start (inclusive)
	end: number; // index after the matching '</span>' (exclusive)
	instanceId: string | null; // data-template-wrapper
	templateKey: string | null; // data-template-key
	segment: string; // substring for convenience
};

/**
 * Find all template wrappers on a single line: <span ... data-template-key="group.key" ...>...</span>
 */
function findAllTemplateWrappersOnLine(line: string): InlineTemplateWrapper[] {
	const out: InlineTemplateWrapper[] = [];
	if (!line) return out;

	const lower = line.toLowerCase();
	let i = 0;
	while (i < line.length) {
		const open = lower.indexOf("<span", i);
		if (open === -1) break;
		const end = findMatchingSpanEndIndexDeterministic(line, open);
		if (end === -1) break;

		const segment = line.slice(open, end);
		// Only accept spans that look like templating-engine wrappers (have data-template-key)
		if (/\bdata-template-key\s*=/.test(segment)) {
			const instanceId = getAttr(segment, "data-template-wrapper");
			const templateKey = getAttr(segment, "data-template-key");
			out.push({ start: open, end, instanceId, templateKey, segment });
		}

		i = end;
	}

	return out;
}

/**
 * Remove a specific wrapper instance from a line, returning updated text and the next caret column.
 * If instanceId is missing in the target, falls back to removing by its [start,end] range.
 */
function removeWrapperOnLineWithCaret(
	line: string,
	target: InlineTemplateWrapper,
	currentCh: number
): { nextLine: string; nextCh: number } {
	const start = target.start;
	const end = target.end;

	// Remove the wrapper segment
	let next = line.slice(0, start) + line.slice(end);

	// Clean up spacing but preserve task/list prefix indentation where relevant
	const taskPrefixRe = /^(\s*[-*+]\s+\[(?: |x|X)\]\s+)/;
	const listPrefixRe = /^(\s*[-*+]\s+)/;

	let nextCh = currentCh;
	const removedLen = end - start;

	// Adjust caret position relative to removed segment
	if (currentCh > end) {
		nextCh = currentCh - removedLen;
	} else if (currentCh >= start && currentCh <= end) {
		// Cursor was inside removed wrapper -> place at former start
		nextCh = start;
	} // else (before start) stays the same

	// Collapse excessive spaces, but preserve structured prefixes
	const taskMatch = next.match(taskPrefixRe);
	if (taskMatch) {
		const prefix = taskMatch[1];
		const rest = next.slice(prefix.length).replace(/ {2,}/g, " ");
		next = prefix + rest;
	} else {
		const listMatch = next.match(listPrefixRe);
		if (listMatch) {
			const prefix = listMatch[1];
			const rest = next.slice(prefix.length).replace(/ {2,}/g, " ");
			next = prefix + rest;
		} else {
			next = next.replace(/ {2,}/g, " ");
		}
	}

	// Ensure single trailing space at end of line (helps caret placement in CM)
	const hadTrailingSpace = /\s+$/.test(next);
	next = next.replace(/\s+$/, " ");
	if (!hadTrailingSpace && /\s$/.test(next) && nextCh === next.length - 1) {
		// keep nextCh pointing at a stable location (not critical)
	}

	// Clamp caret into bounds
	if (nextCh < 0) nextCh = 0;
	if (nextCh > next.length) nextCh = next.length;

	return { nextLine: next, nextCh };
}

type EditorWithPosAtMouseEvent = Editor & {
	posAtMouseEvent?: (ev: MouseEvent) => EditorPosition | null | undefined;
};

interface Cm6LineInfo {
	number?: number;
	from?: number;
}

interface Cm6Like {
	posAtCoords?: (coords: { x: number; y: number }) => number | null;
	state?: {
		doc?: {
			lineAt?: (offset: number) => Cm6LineInfo | null;
		};
	};
}

type EditorWithCm6 = Editor & {
	cm?: Cm6Like;
};

type MarkdownViewWithCm = MarkdownView & {
	editor?: {
		cm?: {
			contentDOM?: HTMLElement;
		};
	};
};

interface TemplatingUxPlugin extends Plugin {
	settings?: {
		enableUxRepeatAgileTemplates?: boolean;
	};
	__tplUxMenuWired?: boolean;
}

interface EditorMenuInfo {
	pos?: EditorPosition;
}

/**
 * Try to resolve editor position from a mouse event using typed Obsidian API.
 * Falls back to CM6 internals if necessary.
 */
function getEditorPositionFromMouseEvent(
	editor: Editor,
	view: MarkdownView,
	ev: MouseEvent
): EditorPosition | null {
	// Preferred: Obsidian typed API (available in newer versions)
	try {
		const editorWithMouse = editor as EditorWithPosAtMouseEvent;
		const pos = editorWithMouse.posAtMouseEvent?.(ev);
		if (pos && typeof pos.line === "number" && typeof pos.ch === "number") {
			return pos;
		}
	} catch {
		// ignore and fallback
	}

	// Fallback: CM6 internals (typed via a minimal structural type, no hard dependency)
	try {
		const editorWithCm = editor as EditorWithCm6;
		const cm = editorWithCm.cm;
		if (!cm || typeof cm.posAtCoords !== "function") return null;

		const offset = cm.posAtCoords({
			x: ev.clientX,
			y: ev.clientY,
		});
		if (typeof offset !== "number") return null;

		const lineInfo = cm.state?.doc?.lineAt?.(offset) ?? null;
		if (!lineInfo) return null;

		const lineNumber =
			typeof lineInfo.number === "number" ? lineInfo.number : 1;
		const from = typeof lineInfo.from === "number" ? lineInfo.from : 0;

		const line = Math.max(0, lineNumber - 1);
		const ch = Math.max(0, offset - from);
		return { line, ch };
	} catch {
		return null;
	}
}

/**
 * Wires editor-level UX shortcuts related to templating.
 * - Double-Enter-to-repeat-last-template-of-same-type on the next task line.
 * - Right-click "Remove Template" in the standard Obsidian editor context menu when the user right-clicks inside a template wrapper.
 */
export function wireTemplatingUxShortcutsDomHandlers(
	app: App,
	view: MarkdownView,
	plugin: Plugin
) {
	// Resolve content root for the editor
	const cmHolder = view as MarkdownViewWithCm;
	const cmContent = cmHolder.editor?.cm?.contentDOM;
	const contentRoot = (cmContent ??
		view.containerEl.querySelector(".cm-content")) as HTMLElement | null;
	const targetEl: HTMLElement = contentRoot ?? view.containerEl;

	const uxPlugin = plugin as TemplatingUxPlugin;

	// 1) Double-Enter repeat (existing behavior)
	const onKeyDown = (evt: KeyboardEvent) => {
		if (evt.key !== "Enter") return;

		// Gate on setting (checked live for immediate effect)
		const enabled = Boolean(
			uxPlugin.settings?.enableUxRepeatAgileTemplates
		);
		if (!enabled) return;

		// Pass the event so processEnter can preventDefault on the second press (when applicable)
		void processEnter(app, view, evt);
	};

	plugin.registerDomEvent(targetEl, "keydown", onKeyDown, { capture: true });

	// 2) Capture the exact editor position of the right-click via DOM "contextmenu"
	// so that the subsequent "editor-menu" handler can place the action accurately.
	let lastContextClick: (EditorPosition & { ts: number }) | null = null;

	const onContextMenu = (ev: MouseEvent) => {
		try {
			const editor = view.editor as Editor;
			const pos = getEditorPositionFromMouseEvent(editor, view, ev);
			lastContextClick = pos ? { ...pos, ts: Date.now() } : null;
		} catch {
			lastContextClick = null;
		}
	};
	plugin.registerDomEvent(targetEl, "contextmenu", onContextMenu, {
		capture: true,
	});

	// 3) Right-click "Remove Template" in the regular Obsidian editor context menu.
	// Register only once per plugin instance to avoid duplicate menu items.
	if (!uxPlugin.__tplUxMenuWired) {
		uxPlugin.__tplUxMenuWired = true;

		const off = app.workspace.on(
			"editor-menu",
			(
				menu: Menu,
				editor: Editor,
				_view: MarkdownView,
				info?: EditorMenuInfo
			) => {
				try {
					if (!editor) return;

					// Prefer position from recent DOM right-click, fall back to caret or info.pos.
					const now = Date.now();
					let pos: EditorPosition | null =
						lastContextClick &&
						now - lastContextClick.ts < 1000
							? {
									line: lastContextClick.line,
									ch: lastContextClick.ch,
							  }
							: null;

					// If Obsidian provides info.pos in newer versions, prefer it
					if (!pos && info?.pos) {
						const p = info.pos;
						if (
							typeof p.line === "number" &&
							typeof p.ch === "number"
						) {
							pos = { line: p.line, ch: p.ch };
						}
					}

					if (!pos) {
						const cur = editor.getCursor?.();
						if (!cur || typeof cur.line !== "number") return;
						pos = cur;
					}

					const lineNo = pos.line;
					const ch = pos.ch;
					const lineText = editor.getLine?.(lineNo) ?? "";
					if (!lineText) return;

					// Find all wrappers and pick the innermost one covering the clicked ch
					const wrappers = findAllTemplateWrappersOnLine(lineText);
					if (!wrappers.length) return;

					const covering = wrappers.filter(
						(w) => ch >= w.start && ch <= w.end
					);
					if (!covering.length) return;

					// Choose the smallest (innermost) covering wrapper
					covering.sort(
						(a, b) => a.end - a.start - (b.end - b.start)
					);
					const target = covering[0];

					menu.addItem((item) => {
						item.setIcon?.("trash");
						item.setTitle("Remove Template");
						item.onClick(() => {
							try {
								const { nextLine, nextCh } =
									removeWrapperOnLineWithCaret(
										lineText,
										target,
										ch
									);

								if (nextLine !== lineText) {
									editor.replaceRange(
										nextLine,
										{ line: lineNo, ch: 0 },
										{
											line: lineNo,
											ch: lineText.length,
										}
									);
									// Place caret as computed to preserve the user's relative position
									editor.setCursor?.({
										line: lineNo,
										ch: nextCh,
									});
								}
							} catch (e) {
								console.error(
									"[templating-ux-shortcuts] Remove Template failed",
									e
								);
							} finally {
								// clear consumed click position
								lastContextClick = null;
							}
						});
					});
				} catch {
					/* ignore menu wiring errors */
				}
			}
		);

		// Tie to plugin lifecycle
		plugin.registerEvent(off);
	}
}