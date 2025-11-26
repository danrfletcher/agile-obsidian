import { App, Notice, TFile } from "obsidian";
import type { Container } from "src/composition/container";
import type { TaskItem, TaskIndexService } from "@features/task-index";
import { cleanupExpiredSnoozes } from "@features/task-snooze";
import { getCurrentUserDisplayName } from "@settings/index";
import { slugifyName } from "@shared/identity";

// Module augmentation: add a strongly-typed custom workspace event
declare module "obsidian" {
	interface Workspace {
		on(
			name: "agile-settings-changed",
			callback: () => void,
			ctx?: Component
		): EventRef;
	}
}

type NoticeWithElement = Notice & {
	noticeEl: HTMLElement;
};

interface MetadataCleanupSettings {
	enableMetadataCleanup?: boolean;
	enableMetadataCleanupOnStart?: boolean;
	enableMetadataCleanupAtMidnight?: boolean;
}

type CleanupExpiredSnoozesTasks = Parameters<typeof cleanupExpiredSnoozes>[1];

// Local helper: compute ms until the next local midnight
function msUntilNextLocalMidnight(): number {
	const now = new Date();
	const next = new Date(
		now.getFullYear(),
		now.getMonth(),
		now.getDate() + 1,
		0,
		0,
		0,
		0
	);
	return Math.max(0, next.getTime() - now.getTime());
}

function isDateExpired(dateStr: string): boolean {
	// Parse YYYY-MM-DD as local date
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
	if (!m) return false;
	const year = Number(m[1]);
	const month = Number(m[2]) - 1;
	const day = Number(m[3]);
	const target = new Date(year, month, day);
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	return target.getTime() < today.getTime();
}

// Lightweight global progress notice (mirrors style of canonical formatter)
// - Only shown if operation exceeds PROGRESS_SHOW_AFTER_MS
class GlobalProgressNotice {
	private notice: Notice | null = null;
	private wrapper: HTMLDivElement | null = null;
	private bar: HTMLDivElement | null = null;
	private label: HTMLDivElement | null = null;
	private rafId: number | null = null;

	private started = false;
	private ended = false;

	private pendingPct = 0;
	private pendingText = "";

	private ensureElements(title: string) {
		if (this.notice && this.wrapper && this.bar && this.label) return;

		this.notice = new Notice("", 0);
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

		const noticeEl = (this.notice as NoticeWithElement).noticeEl;

		// Clear any existing children without relying on non-standard `.empty()`
		while (noticeEl.firstChild) {
			noticeEl.removeChild(noticeEl.firstChild);
		}
		noticeEl.appendChild(wrapper);

		this.wrapper = wrapper;
		this.bar = barInner;
		this.label = label;
	}

	private schedulePaint() {
		if (this.rafId != null) return;
		this.rafId = requestAnimationFrame(() => {
			this.rafId = null;
			if (this.bar) this.bar.style.width = `${this.pendingPct}%`;
			if (this.label) this.label.textContent = this.pendingText;
		});
	}

	start(title: string, total: number) {
		if (this.ended || this.started) return;
		this.started = true;
		this.ensureElements(title);
		this.pendingPct = 0;
		this.pendingText = `0 / ${Math.max(0, total)}`;
		this.schedulePaint();
	}

	update(current: number, total: number, message?: string) {
		if (!this.started || this.ended) return;
		const clampedTotal = Math.max(1, total);
		const clampedCur = Math.max(0, Math.min(current, clampedTotal));
		const pct = Math.floor((clampedCur / clampedTotal) * 100);
		this.pendingPct = pct;
		this.pendingText =
			message ?? `${clampedCur} / ${clampedTotal} (${pct}%)`;
		this.schedulePaint();
	}

	end() {
		if (this.ended) return;
		this.ended = true;
		if (this.notice) this.notice.hide();
		this.cleanup();
	}

	private cleanup() {
		if (this.rafId != null) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
		this.notice = null;
		this.wrapper = null;
		this.bar = null;
		this.label = null;
		this.started = false;
	}
}

// Build a file->set-of-line-numbers map using TaskIndexService snapshot
function buildLinesByFile(tasks: TaskItem[]): Map<string, Set<number>> {
	const linesByFile = new Map<string, Set<number>>();
	for (const t of tasks as (TaskItem & { _uniqueId?: string })[]) {
		const uid = t._uniqueId;
		// Expect t.line is zero-based (consistent with index + snooze-utils)
		if (!uid || typeof t.line !== "number") continue;
		const idx = uid.lastIndexOf(":");
		if (idx <= 0) continue;
		const filePath = uid.slice(0, idx);
		if (!linesByFile.has(filePath)) linesByFile.set(filePath, new Set());
		linesByFile.get(filePath)!.add(t.line);
	}
	return linesByFile;
}

/**
 * Remove expired "snooze all subtasks" user-specific markers and expired global snoozes.
 * Returns set of modified file paths.
 *
 * Important: Preserve any trailing whitespace on lines. We intentionally do NOT trim EOL spaces,
 * because other parts of the system/caret mapping may rely on them, and the canonical formatter
 * already handles internal whitespace normalization where needed.
 */
async function cleanupExpiredSnoozeAllAndGlobal(
	app: App,
	linesByFile: Map<string, Set<number>>,
	userSlug: string
): Promise<Set<string>> {
	const changedPaths = new Set<string>();
	if (linesByFile.size === 0) return changedPaths;

	// Per-user markers: '💤⬇️<span style="display: none">user</span> YYYY-MM-DD'
	const userEsc = userSlug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").trim();
	const snoozeAllUserRe = new RegExp(
		String.raw`💤⬇️\s*<span\s+style="display:\s*none">\s*${userEsc}\s*<\/span>\s*(\d{4}-\d{2}-\d{2})`,
		"g"
	);

	// Expired global snoozes: '💤 YYYY-MM-DD' and '💤⬇️ YYYY-MM-DD' (no <span>, no 🗂️)
	const globalSnoozeRe = /💤\s*(\d{4}-\d{2}-\d{2})(?!\s*<span)/g; // individual
	const globalSnoozeAllRe = /💤⬇️\s*(\d{4}-\d{2}-\d{2})(?!\s*(?:<span|🗂️))/g; // inherited/all

	for (const [path, lineSet] of linesByFile.entries()) {
		const file = app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) continue;

		const content = await app.vault.read(file);
		const lines = content.split("\n");
		let modified = false;

		for (const lineNo of lineSet) {
			if (lineNo < 0 || lineNo >= lines.length) continue;
			const original = lines[lineNo];

			let updated = original;

			// Remove expired user-specific snooze-all markers
			updated = updated.replace(
				snoozeAllUserRe,
				(match: string, date: string) => {
					return isDateExpired(date) ? "" : match;
				}
			);

			// Remove expired global snooze markers
			updated = updated.replace(
				globalSnoozeRe,
				(match: string, date: string) => {
					return isDateExpired(date) ? "" : match;
				}
			);
			updated = updated.replace(
				globalSnoozeAllRe,
				(match: string, date: string) => {
					return isDateExpired(date) ? "" : match;
				}
			);

			if (updated !== original) {
				// Preserve trailing whitespace exactly as produced by replacements.
				// Do not trim end-of-line spaces here.
				lines[lineNo] = updated;
				modified = true;
			}
		}

		if (modified) {
			await app.vault.modify(file, lines.join("\n"));
			changedPaths.add(path);
		}
	}

	return changedPaths;
}

async function runMetadataCleanupOnce(
	app: App,
	taskIndex: TaskIndexService,
	userDisplayName: string
): Promise<void> {
	const tasks = taskIndex.getAllTasks() as TaskItem[];
	const linesByFile = buildLinesByFile(tasks);
	const totalFiles = linesByFile.size;

	// Deferred progress (only show if runtime > 1s)
	const PROGRESS_SHOW_AFTER_MS = 1000;
	const startTs = Date.now();
	let progressVisible = false;
	let progress: GlobalProgressNotice | null = null;
	let lastUpdateTs = 0;

	const maybeStartProgress = () => {
		if (progressVisible) return;
		if (Date.now() - startTs >= PROGRESS_SHOW_AFTER_MS) {
			progressVisible = true;
			progress = new GlobalProgressNotice();
			progress.start("Cleaning up task metadata…", totalFiles);
			lastUpdateTs = 0;
		}
	};
	const maybeUpdateProgress = (current: number) => {
		if (!progressVisible || !progress) return;
		const now = Date.now();
		// modest throttling
		if (now - lastUpdateTs >= 150) {
			lastUpdateTs = now;
			progress.update(current, totalFiles);
		}
	};
	const endProgress = () => {
		if (progressVisible && progress) {
			progress.update(totalFiles, totalFiles);
			progress.end();
		}
	};

	// 1) Use existing cleanup for per-user single-task snoozes (💤<span>user</span> date)
	await cleanupExpiredSnoozes(
		app,
		tasks as CleanupExpiredSnoozesTasks,
		userDisplayName || ""
	);
	// Check if we need to show a notice after this stage
	maybeStartProgress();

	// 2) Additional pass for "snooze all subtasks" (💤⬇️<span>user</span> date) and expired global snoozes.
	const userSlug = slugifyName(userDisplayName || "") || "";
	if (totalFiles === 0) {
		endProgress();
		return;
	}

	let processed = 0;
	const batchSize = 10;
	let batchCounter = 0;

	// We iterate in a stable order to keep progress perception nice
	const entries = Array.from(linesByFile.entries());

	// Process per-file in our own loop to allow progress updates
	const changedBySnoozeAll = new Set<string>();
	for (const [path, lineSet] of entries) {
		// We call our helper for only this file by making a single-entry map
		const single = new Map<string, Set<number>>([[path, lineSet]]);
		const changed = await cleanupExpiredSnoozeAllAndGlobal(
			app,
			single,
			userSlug
		);
		changed.forEach((p) => changedBySnoozeAll.add(p));

		processed++;
		maybeStartProgress();
		maybeUpdateProgress(processed);

		// Cooperative yield each N files to keep UI responsive
		batchCounter++;
		if (batchCounter >= batchSize) {
			batchCounter = 0;
			await new Promise<void>((r) => setTimeout(r, 0));
			maybeStartProgress();
		}
	}

	endProgress();

	// Note: Vault.modify fires "modify" events -> task index will refresh automatically.
	// No manual index update is strictly required here.
}

export function registerTaskMetadataCleanup(container: Container) {
	const { app, plugin, settingsService } = container;
	const taskIndex = container.taskIndexService;
	if (!taskIndex) return;

	let running = false;
	let disposed = false;
	let midnightTimeout: number | null = null;
	let dailyInterval: number | null = null;

	const getSettingsSnapshot = (): MetadataCleanupSettings => {
		try {
			const svc = settingsService as {
				getRaw?: () => MetadataCleanupSettings;
				get?: () => MetadataCleanupSettings;
			};
			if (svc && typeof svc.getRaw === "function") {
				return svc.getRaw();
			}
			if (svc && typeof svc.get === "function") {
				return svc.get();
			}
		} catch {
			// ignore and fall back to container.settings
		}
		return (container.settings ?? {}) as MetadataCleanupSettings;
	};

	const getFlags = () => {
		const s = getSettingsSnapshot();
		return {
			master: !!s.enableMetadataCleanup,
			onStart: !!s.enableMetadataCleanupOnStart,
			atMidnight: !!s.enableMetadataCleanupAtMidnight,
		};
	};

	const clearTimers = () => {
		if (midnightTimeout != null) {
			window.clearTimeout(midnightTimeout);
			midnightTimeout = null;
		}
		if (dailyInterval != null) {
			window.clearInterval(dailyInterval);
			dailyInterval = null;
		}
	};

	const runCore = async () => {
		if (running || disposed) return;
		running = true;
		try {
			const settings = settingsService.getRaw();
			const userDisplayName = getCurrentUserDisplayName(settings) || "";
			await runMetadataCleanupOnce(app, taskIndex, userDisplayName);
		} catch {
			// swallow errors silently per "quiet" requirement
		} finally {
			running = false;
		}
	};

	// Respect master toggle for automated runs
	const runIfEnabled = async () => {
		const flags = getFlags();
		if (!flags.master) return;
		await runCore();
	};

	// Manual runs should execute regardless of master toggle (like "Format All Files")
	const runManual = async () => {
		await runCore();
	};

	const scheduleFromSettings = () => {
		clearTimers();
		if (disposed) return;
		const flags = getFlags();
		// Schedule next midnight only if master + atMidnight
		if (flags.master && flags.atMidnight) {
			const delay = msUntilNextLocalMidnight();
			midnightTimeout = window.setTimeout(async () => {
				if (disposed) return;
				await runIfEnabled();
				// Then every 24h while enabled
				dailyInterval = window.setInterval(async () => {
					if (disposed) return;
					await runIfEnabled();
				}, 24 * 60 * 60 * 1000);
			}, delay);
		}
	};

	// Initial boot: run on start if enabled, then schedule timers from settings
	(() => {
		const flags = getFlags();
		if (flags.master && flags.onStart) {
			void runIfEnabled();
		}
		scheduleFromSettings();
	})();

	// React to settings changes immediately (enable/disable and schedules)
	const offSettingsChanged = app.workspace.on(
		"agile-settings-changed",
		() => {
			// Re-schedule timers to reflect toggles immediately
			scheduleFromSettings();
		}
	);
	plugin.registerEvent(offSettingsChanged);

	// Manual “run across vault now” trigger (like canonical formatter’s format-all)
	plugin.registerEvent(
		// @ts-ignore - custom workspace events supported
		app.workspace.on("agile-metadata-cleanup-all", async () => {
			try {
				new Notice("Starting metadata cleanup across vault…");
				await runManual();
				new Notice("Metadata cleanup complete.");
			} catch (e) {
				new Notice(
					`Metadata cleanup failed: ${
						e instanceof Error ? e.message : String(e)
					}`
				);
			}
		})
	);

	// Cleanup timers on unload
	plugin.register(() => {
		disposed = true;
		clearTimers();
	});
}