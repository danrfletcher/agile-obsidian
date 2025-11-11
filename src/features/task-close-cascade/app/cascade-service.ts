import type { App, MarkdownView } from "obsidian";
import {
	CascadePolicy,
	EditorPort,
	EventBusPort,
	LineClassifierPort,
	PromptPort,
	TokenOpsPort,
	VaultPort,
} from "../domain/ports";
import { computeCascadeEdits } from "../domain/cascade";
import { detectClosedTransitions, wouldCascade } from "../domain/detection";
import { BufferEditor, ObsidianEditor } from "@platform/obsidian";

/**
 * Central orchestrator for detecting, prompting, and applying closed cascade edits.
 * Encapsulates dedupe and write suppression.
 */
export class CascadeService {
	private classifier: LineClassifierPort;
	private tokens: TokenOpsPort;
	private prompt: PromptPort;
	private bus: EventBusPort;
	private policy: CascadePolicy;

	private prompted = new Map<string, number>(); // key -> until
	private suppressedPaths = new Map<string, number>(); // path -> until

	constructor(deps: {
		classifier: LineClassifierPort;
		tokens: TokenOpsPort;
		prompt: PromptPort;
		eventBus: EventBusPort;
		policy?: Partial<CascadePolicy>;
	}) {
		this.classifier = deps.classifier;
		this.tokens = deps.tokens;
		this.prompt = deps.prompt;
		this.bus = deps.eventBus;
		this.policy = {
			promptDedupMs: deps.policy?.promptDedupMs ?? 1500,
			writeSuppressMs: deps.policy?.writeSuppressMs ?? 800,
		};
	}

	private now() {
		return Date.now();
	}
	private wasPrompted(key: string): boolean {
		const until = this.prompted.get(key);
		if (!until) return false;
		if (this.now() <= until) return true;
		this.prompted.delete(key);
		return false;
	}
	private markPrompted(key: string) {
		this.prompted.set(key, this.now() + this.policy.promptDedupMs);
	}
	private shouldSuppress(path: string): boolean {
		const until = this.suppressedPaths.get(path);
		if (!until) return false;
		if (this.now() <= until) return true;
		this.suppressedPaths.delete(path);
		return false;
	}
	private suppressWrites(path: string) {
		this.suppressedPaths.set(
			path,
			this.now() + this.policy.writeSuppressMs
		);
	}

	/**
	 * Apply computed edits to an EditorPort.
	 */
	private applyEditsToEditor(editor: EditorPort, edits: Map<number, string>) {
		for (const [line0, newText] of edits.entries()) {
			editor.setLine(line0, newText);
		}
	}

	/**
	 * Attempt to cascade in an active editor view (interactive).
	 * If parentLine0FromEvent is provided, skip snapshot diffing and use it directly.
	 * Returns true if cascade was applied.
	 */
	async maybeCascadeInEditor(
		app: App,
		path: string,
		mdView: MarkdownView,
		parentLine0FromEvent?: number
	): Promise<boolean> {
		if (this.shouldSuppress(path)) return false;

		const editorPort = new ObsidianEditor((mdView as any).editor);
		const linesNow = editorPort.getAllLines();

		let targetLine0: number | null = null;

		if (typeof parentLine0FromEvent === "number") {
			// Use explicit parent line from event to avoid snapshot dependency
			targetLine0 = parentLine0FromEvent;
			if (
				targetLine0 < 0 ||
				targetLine0 >= linesNow.length ||
				!wouldCascade(
					linesNow,
					targetLine0,
					this.classifier,
					this.tokens
				)
			) {
				// Seed snapshot and exit if nothing to do
				CascadingSnapshots.setViewSnapshot(mdView, path, linesNow);
				return false;
			}
		} else {
			// Fall back to snapshot diffing
			const snapPrev = CascadingSnapshots.getViewSnapshot(
				mdView,
				linesNow
			);
			const transitions = detectClosedTransitions(
				snapPrev.lines,
				linesNow,
				this.classifier,
				this.tokens
			);

			if (!transitions.length) {
				CascadingSnapshots.setViewSnapshot(mdView, path, linesNow);
				return false;
			}
			targetLine0 = transitions[transitions.length - 1].line0;

			if (
				!wouldCascade(
					linesNow,
					targetLine0,
					this.classifier,
					this.tokens
				)
			) {
				CascadingSnapshots.setViewSnapshot(mdView, path, linesNow);
				return false;
			}
		}

		const key = `${path}:${targetLine0}`;
		if (this.wasPrompted(key)) {
			CascadingSnapshots.setViewSnapshot(mdView, path, linesNow);
			return false;
		}
		this.markPrompted(key);

		const allow = await this.prompt.askCascadeConfirm();
		if (!allow) {
			CascadingSnapshots.setViewSnapshot(mdView, path, linesNow);
			return false;
		}

		const edits = computeCascadeEdits(
			linesNow,
			targetLine0,
			this.classifier,
			this.tokens
		);
		if (edits.size === 0) {
			CascadingSnapshots.setViewSnapshot(
				mdView,
				path,
				editorPort.getAllLines()
			);
			return false;
		}

		this.suppressWrites(path);
		this.applyEditsToEditor(editorPort, edits);

		CascadingSnapshots.setViewSnapshot(
			mdView,
			path,
			editorPort.getAllLines()
		);
		return true;
	}

	/**
	 * Attempt to cascade headlessly by reading/writing the file (when not active in editor).
	 * Returns true if changes were written.
	 */
	async maybeCascadeHeadless(
		app: App,
		vault: VaultPort,
		path: string,
		parentLine0FromEvent?: number
	): Promise<boolean> {
		if (this.shouldSuppress(path)) return false;

		const nextContent = await vault.readFile(path);
		const nextLines = nextContent.split(/\r?\n/);
		const prevLines = CascadingSnapshots.getFileSnapshot(path) ?? nextLines;

		// Detect transitions across the file
		const transitions = detectClosedTransitions(
			prevLines,
			nextLines,
			this.classifier,
			this.tokens
		);
		if (transitions.length === 0) {
			CascadingSnapshots.setFileSnapshot(path, nextLines);
			return false;
		}

		// Use explicit parentLine0 if supplied from event; otherwise last detected
		const last =
			parentLine0FromEvent != null
				? { line0: parentLine0FromEvent }
				: transitions[transitions.length - 1];

		if (
			!wouldCascade(nextLines, last.line0, this.classifier, this.tokens)
		) {
			CascadingSnapshots.setFileSnapshot(path, nextLines);
			return false;
		}

		const key = `${path}:${last.line0}`;
		if (this.wasPrompted(key)) {
			CascadingSnapshots.setFileSnapshot(path, nextLines);
			return false;
		}
		this.markPrompted(key);

		const allow = await this.prompt.askCascadeConfirm();
		if (!allow) {
			CascadingSnapshots.setFileSnapshot(path, nextLines);
			return false;
		}

		const headless = new BufferEditor(nextLines);
		const edits = computeCascadeEdits(
			nextLines,
			last.line0,
			this.classifier,
			this.tokens
		);
		if (edits.size === 0) {
			CascadingSnapshots.setFileSnapshot(path, headless.getAllLines());
			return false;
		}

		this.suppressWrites(path);
		this.applyEditsToEditor(headless, edits);

		const finalLines = headless.getAllLines();
		if (finalLines.join("\n") !== nextContent) {
			this.bus.dispatchPrepareOptimisticFileChange(path);
			await vault.writeFile(path, finalLines.join("\n"));
			CascadingSnapshots.setFileSnapshot(path, finalLines);
			return true;
		} else {
			CascadingSnapshots.setFileSnapshot(path, nextLines);
			return false;
		}
	}
}

/**
 * Snapshot manager for views and files to enable transition detection.
 */
class CascadingSnapshots {
	private static viewSnaps = new WeakMap<
		MarkdownView,
		{ path: string; lines: string[] }
	>();
	private static fileSnaps = new Map<string, string[]>();

	static getViewSnapshot(
		view: MarkdownView,
		fallback: string[]
	): { path?: string; lines: string[] } {
		const snap = this.viewSnaps.get(view);
		return snap ?? { lines: fallback.slice() };
	}
	static setViewSnapshot(view: MarkdownView, path: string, lines: string[]) {
		this.viewSnaps.set(view, { path, lines: lines.slice() });
		this.fileSnaps.set(path, lines.slice());
	}
	static getFileSnapshot(path: string): string[] | undefined {
		return this.fileSnaps.get(path)?.slice();
	}
	static setFileSnapshot(path: string, lines: string[]) {
		this.fileSnaps.set(path, lines.slice());
	}
}
