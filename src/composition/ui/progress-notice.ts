import type { Notice } from "obsidian";
import { MarkdownView, Notice as ObsidianNotice } from "obsidian";

/**
 * ProgressNotice
 * Per-view strong singleton to show progress for long-running operations.
 * Prevents duplicate instances per MarkdownView and cleans up on end().
 */
export class ProgressNotice {
	private static activeForView = new WeakMap<MarkdownView, ProgressNotice>();
	static getOrCreateForView(view: MarkdownView): ProgressNotice {
		const existing = ProgressNotice.activeForView.get(view);
		if (existing) return existing;
		const created = new ProgressNotice(view);
		ProgressNotice.activeForView.set(view, created);
		return created;
	}

	private constructor(view: MarkdownView) {
		this.view = view;
	}

	private view: MarkdownView;
	private notice: Notice | null = null;
	private wrapper: HTMLDivElement | null = null;
	private bar: HTMLDivElement | null = null;
	private label: HTMLDivElement | null = null;
	private started = false;
	private ended = false;
	private rafId: number | null = null;
	private pendingPct = 0;
	private pendingText = "";

	private ensureElements(title: string): void {
		if (this.notice && this.wrapper && this.bar && this.label) return;

		const doc = globalThis.document;
		if (!doc) {
			return;
		}

		this.notice = new ObsidianNotice("", 0);

		const wrapper = doc.createElement("div");
		wrapper.addClass("agile-progress-notice-wrapper");

		const titleEl = doc.createElement("div");
		titleEl.textContent = title;
		titleEl.addClass("agile-progress-notice-title");
		wrapper.appendChild(titleEl);

		const barOuter = doc.createElement("div");
		barOuter.addClass("agile-progress-notice-bar-outer");

		const barInner = doc.createElement("div");
		barInner.addClass("agile-progress-notice-bar-inner");
		barOuter.appendChild(barInner);

		const label = doc.createElement("div");
		label.addClass("agile-progress-notice-label");

		wrapper.appendChild(barOuter);
		wrapper.appendChild(label);

		const noticeWithEl = this.notice as ObsidianNotice & {
			messageEl?: HTMLElement & { empty?: () => void };
		};
		noticeWithEl.messageEl?.empty?.();
		noticeWithEl.messageEl?.appendChild(wrapper);

		this.wrapper = wrapper;
		this.bar = barInner;
		this.label = label;
	}

	private schedulePaint(): void {
		if (this.rafId != null) return;

		const raf = globalThis.requestAnimationFrame;
		if (!raf) {
			// Fallback: update immediately if rAF is unavailable.
			if (this.bar) this.bar.style.width = `${this.pendingPct}%`;
			if (this.label) this.label.textContent = this.pendingText;
			return;
		}

		this.rafId = raf(() => {
			this.rafId = null;
			if (this.bar) this.bar.style.width = `${this.pendingPct}%`;
			if (this.label) this.label.textContent = this.pendingText;
		});
	}

	start(title: string, total: number): void {
		if (this.ended || this.started) return;
		this.started = true;
		this.ensureElements(title);
		this.pendingPct = 0;
		this.pendingText = `0 / ${Math.max(0, total)}`;
		this.schedulePaint();
	}

	update(current: number, total: number, message?: string): void {
		if (!this.started || this.ended) return;
		const clampedTotal = Math.max(1, total);
		const clampedCur = Math.max(0, Math.min(current, clampedTotal));
		const pct = Math.floor((clampedCur / clampedTotal) * 100);
		this.pendingPct = pct;
		this.pendingText =
			message ?? `${clampedCur} / ${clampedTotal} (${pct}%)`;
		this.schedulePaint();
	}

	end(): void {
		if (this.ended) return;
		this.ended = true;
		if (this.notice) this.notice.hide();
		this.cleanup();
	}

	private cleanup(): void {
		if (this.rafId != null) {
			const cancelRaf = globalThis.cancelAnimationFrame;
			if (cancelRaf) {
				cancelRaf(this.rafId);
			}
			this.rafId = null;
		}
		this.notice = null;
		this.wrapper = null;
		this.bar = null;
		this.label = null;
		this.started = false;
		ProgressNotice.activeForView.delete(this.view);
	}
}