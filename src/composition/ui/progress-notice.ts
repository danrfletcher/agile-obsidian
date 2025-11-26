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

		this.notice = new ObsidianNotice("", 0);
		const wrapper = document.createElement("div");
		wrapper.style.minWidth = "260px";
		wrapper.style.maxWidth = "360px";
		wrapper.style.display = "flex";
		wrapper.style.flexDirection = "column";
		wrapper.style.gap = "8px";

		const titleEl = document.createElement("div");
		titleEl.textContent = title;
		titleEl.style.fontWeight = "600";
		titleEl.style.fontSize = "12px";
		wrapper.appendChild(titleEl);

		const barOuter = document.createElement("div");
		barOuter.style.height = "6px";
		barOuter.style.background = "var(--background-modifier-border)";
		barOuter.style.borderRadius = "3px";
		barOuter.style.overflow = "hidden";

		const barInner = document.createElement("div");
		barInner.style.height = "100%";
		barInner.style.width = "0%";
		barInner.style.background = "var(--interactive-accent)";
		barInner.style.transition = "width 140ms linear";
		barOuter.appendChild(barInner);

		const label = document.createElement("div");
		label.style.fontSize = "11px";
		label.style.opacity = "0.8";

		wrapper.appendChild(barOuter);
		wrapper.appendChild(label);

		const noticeWithEl = this.notice as ObsidianNotice & {
			noticeEl?: HTMLElement & { empty?: () => void };
		};
		noticeWithEl.noticeEl?.empty?.();
		noticeWithEl.noticeEl?.appendChild(wrapper);

		this.wrapper = wrapper;
		this.bar = barInner;
		this.label = label;
	}

	private schedulePaint(): void {
		if (this.rafId != null) return;
		this.rafId = requestAnimationFrame(() => {
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
			cancelAnimationFrame(this.rafId);
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