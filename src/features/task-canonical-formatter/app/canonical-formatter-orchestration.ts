/**
 * Orchestrates when and how canonical formatting runs.
 * - Subscribes to host/editor events via a Port.
 * - Gates triggers by reason (commit, cursor-move, leaf-or-file, manual).
 * - Debounces/coalesces runs and serializes execution.
 * - Supports cancellation of in-flight whole-file runs via AbortController.
 */

import type { CanonicalFormatterService } from "./canonical-formatter-service";
import type { CanonicalFormatterPort } from "./canonical-formatter-ports";

export type CanonicalFormatterOrchestrator = {
	/**
	 * Triggers a single normalization run immediately (subject to gating by reason).
	 * Defaults to "manual" reason and "line" scope.
	 */
	triggerOnceNow: (reason?: TriggerReason, scope?: TriggerScope) => void;
	/**
	 * Unsubscribes from events, aborts any in-flight work, clears timers.
	 */
	dispose: () => void;
};

export type TriggerReason =
	| "commit"
	| "cursor-move"
	| "leaf-or-file"
	| "manual";
export type TriggerScope = "file" | "line" | "cursor";

type TimerHandle = ReturnType<typeof setTimeout> | null;

export function createCanonicalFormatterOrchestrator(
	svc: CanonicalFormatterService,
	opts?: {
		port?: CanonicalFormatterPort;
		debounceMs?: number;
		/**
		 * Live settings snapshot provider. Used to gate triggers in real-time.
		 * Defaults: master=true, onLineCommit=true, onLeafChange=true
		 */
		shouldRun?: () => {
			master: boolean;
			onLineCommit: boolean;
			onLeafChange: boolean;
		};
	}
): CanonicalFormatterOrchestrator {
	const debounceMs = opts?.debounceMs ?? 300;
	const port = opts?.port;

	const getFlags = () =>
		opts?.shouldRun?.() ?? {
			master: true,
			onLineCommit: true,
			onLeafChange: true,
		};

	// Centralized, reason-scoped gating logic.
	const reasonAllows = (
		reason: TriggerReason,
		flags = getFlags()
	): boolean => {
		// Master must be on for any automation
		if (!flags.master) return false;

		switch (reason) {
			case "commit":
			case "cursor-move":
				return !!flags.onLineCommit;
			case "leaf-or-file":
				return !!flags.onLeafChange;
			case "manual":
			default:
				// Manual runs require only master=true
				return true;
		}
	};

	let timer: TimerHandle = null;
	let unsubs: Array<() => void> = [];
	let disposed = false;

	// Serialize runs and coalesce triggers while a run is in flight.
	let isRunning = false;
	let queued: {
		reason: TriggerReason;
		scope: TriggerScope;
		targetLineNumber?: number | null;
	} | null = null;

	// Abort controller for in-flight whole-file runs
	let currentAbort: AbortController | null = null;

	const clearTimer = () => {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
	};

	const abortInFlightIfAny = () => {
		try {
			currentAbort?.abort();
		} catch {
			// swallow
		} finally {
			currentAbort = null;
		}
	};

	const runOnce = async (
		_reason: TriggerReason,
		scope: TriggerScope,
		targetLineNumber?: number | null
	) => {
		if (disposed) return;

		// At this point gating should have been checked; still defensively gate master.
		const flags = getFlags();
		if (!flags.master) return;

		// Prepare abort controller for long operations (file scope).
		// For line-scope operations, we still create a controller to unify code paths,
		// but it is only used if normalizeWholeFile is invoked.
		abortInFlightIfAny();
		currentAbort = new AbortController();

		// Scope handling:
		if (scope === "file") {
			const all =
				typeof port?.getAllLines === "function"
					? port.getAllLines()
					: null;
			if (!all) return;
			await svc.normalizeWholeFile(all, {
				abortSignal: currentAbort.signal,
			});
			return;
		}

		// Specific line requested (e.g., leaving a line)
		if (
			typeof targetLineNumber === "number" &&
			typeof svc.normalizeLineNumber === "function"
		) {
			svc.normalizeLineNumber(targetLineNumber);
			return;
		}

		// "line" or "cursor": normalize current line
		try {
			svc.normalizeCurrentLine();
		} catch {
			// swallow
		}
	};

	const dispatch = async (
		reason: TriggerReason,
		scope: TriggerScope,
		targetLineNumber?: number | null
	) => {
		if (isRunning) {
			queued = { reason, scope, targetLineNumber };
			return;
		}

		isRunning = true;
		try {
			await runOnce(reason, scope, targetLineNumber ?? null);
		} finally {
			isRunning = false;
			// Clear current abort controller when a run finishes
			currentAbort = null;
		}

		if (queued) {
			const next = queued;
			queued = null;
			void dispatch(next.reason, next.scope, next.targetLineNumber);
		}
	};

	const schedule = (
		reason: TriggerReason,
		scope: TriggerScope,
		targetLineNumber?: number | null
	) => {
		if (disposed) return;
		clearTimer();

		// Reason-scoped gating: enforce both master and the appropriate toggle.
		if (!reasonAllows(reason)) return;

		timer = setTimeout(() => {
			timer = null;
			void dispatch(reason, scope, targetLineNumber ?? null);
		}, debounceMs);
	};

	// Cursor line changed -> normalize the PREVIOUS line (line user just left)
	if (port?.onCursorLineChanged) {
		const off = port.onCursorLineChanged(({ prevLine }) => {
			if (!reasonAllows("cursor-move")) return;
			schedule("cursor-move", "line", prevLine);
		});
		unsubs.push(off);
	}

	// Enter / commit -> normalize current line at time of event
	if (port?.onLineCommitted) {
		const off = port.onLineCommitted(() => {
			if (!reasonAllows("commit")) return;
			schedule("commit", "line", null);
		});
		unsubs.push(off);
	}

	// Leaf or file change -> whole file
	if (port?.onLeafOrFileChanged) {
		const off = port.onLeafOrFileChanged(() => {
			if (!reasonAllows("leaf-or-file")) return;
			schedule("leaf-or-file", "file", null);
		});
		unsubs.push(off);
	}

	// Safety: no hooks -> single microtask tick as a one-off line format
	if (
		!port?.onLineCommitted &&
		!port?.onCursorLineChanged &&
		!port?.onLeafOrFileChanged
	) {
		setTimeout(() => {
			if (!reasonAllows("manual")) return;
			schedule("manual", "line", null);
		}, debounceMs);
	}

	return {
		triggerOnceNow(reason?: TriggerReason, scope?: TriggerScope) {
			const r = reason ?? "manual";
			const s = scope ?? "line";

			if (!reasonAllows(r)) return;

			clearTimer();
			void dispatch(r, s, null);
		},
		dispose() {
			disposed = true;
			clearTimer();
			// Abort any in-flight long operation
			abortInFlightIfAny();
			// Unsubscribe listeners
			for (const off of unsubs) {
				try {
					off();
				} catch {
					// swallow
				}
			}
			unsubs = [];
			// Drop any queued runs
			queued = null;
		},
	};
}
