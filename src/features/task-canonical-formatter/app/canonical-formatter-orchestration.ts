import type { CanonicalFormatterService } from "./canonical-formatter-service";
import type { CanonicalFormatterPort } from "./canonical-formatter-ports";

export type CanonicalFormatterOrchestrator = {
	triggerOnceNow: (reason?: TriggerReason, scope?: TriggerScope) => void;
	dispose: () => void;
};

export type TriggerReason =
	| "commit"
	| "cursor-move"
	| "leaf-or-file"
	| "manual";
export type TriggerScope = "file" | "line" | "cursor";

export function createCanonicalFormatterOrchestrator(
	svc: CanonicalFormatterService,
	opts?: {
		port?: CanonicalFormatterPort;
		debounceMs?: number;
	}
): CanonicalFormatterOrchestrator {
	const debounceMs = opts?.debounceMs ?? 300;
	const port = opts?.port;

	let timer: number | null = null;
	let unsubs: Array<() => void> = [];
	let disposed = false;

	// Serialize runs and coalesce triggers while a run is in flight.
	let isRunning = false;
	let queued: {
		reason: TriggerReason;
		scope: TriggerScope;
		targetLineNumber?: number | null;
	} | null = null;

	const clearTimer = () => {
		if (timer !== null) {
			clearTimeout(timer as unknown as number);
			timer = null;
		}
	};

	const runOnce = async (
		reason: TriggerReason,
		scope: TriggerScope,
		targetLineNumber?: number | null
	) => {
		if (disposed) return;

		// Scope handling:
		// - "file": normalize whole file atomically
		if (scope === "file") {
			const all =
				typeof port?.getAllLines === "function"
					? port.getAllLines()
					: null;
			if (!all) return;
			await svc.normalizeWholeFile(all);
			return;
		}

		// - Specific line requested (e.g., leaving a line)
		if (
			typeof targetLineNumber === "number" &&
			typeof svc.normalizeLineNumber === "function"
		) {
			svc.normalizeLineNumber(targetLineNumber);
			return;
		}

		// - "line" or "cursor": normalize current line
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
		// If a run is already in progress, just coalesce to the latest request.
		if (isRunning) {
			queued = { reason, scope, targetLineNumber };
			return;
		}

		isRunning = true;
		try {
			await runOnce(reason, scope, targetLineNumber ?? null);
		} finally {
			isRunning = false;
		}

		// If something queued while running, execute the latest one now.
		if (queued) {
			const next = queued;
			queued = null;
			// Fire and forget; serialize via isRunning
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
		timer = setTimeout(() => {
			timer = null;
			void dispatch(reason, scope, targetLineNumber ?? null);
		}, debounceMs) as unknown as number;
	};

	// Cursor line changed -> normalize the PREVIOUS line (line user just left)
	if (port?.onCursorLineChanged) {
		const off = port.onCursorLineChanged(({ prevLine }) => {
			// Normalize the line that was left
			schedule("cursor-move", "line", prevLine);
		});
		unsubs.push(off);
	}

	// Enter / commit -> normalize current line at time of event
	if (port?.onLineCommitted) {
		const off = port.onLineCommitted(() => {
			schedule("commit", "line", null);
		});
		unsubs.push(off);
	}

	// Leaf or file change -> whole file
	if (port?.onLeafOrFileChanged) {
		const off = port.onLeafOrFileChanged(() => {
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
		setTimeout(() => schedule("manual", "line", null), debounceMs);
	}

	return {
		triggerOnceNow(reason?: TriggerReason, scope?: TriggerScope) {
			const r = reason ?? "manual";
			const s = scope ?? "line";
			clearTimer();
			void dispatch(r, s, null);
		},
		dispose() {
			disposed = true;
			clearTimer();
			for (const off of unsubs) {
				try {
					off();
				} catch {}
			}
			unsubs = [];
		},
	};
}
