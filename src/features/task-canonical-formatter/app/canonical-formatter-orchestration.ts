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
	let queued: { reason: TriggerReason; scope: TriggerScope } | null = null;

	const clearTimer = () => {
		if (timer !== null) {
			clearTimeout(timer as unknown as number);
			timer = null;
		}
	};

	const runOnce = async (reason: TriggerReason, scope: TriggerScope) => {
		if (disposed) return;

		// Scope handling:
		// - "file": normalize whole file atomically
		// - "line" or "cursor": normalize current line
		if (scope === "file") {
			const all =
				typeof port?.getAllLines === "function"
					? port.getAllLines()
					: null;
			if (!all) return;
			await svc.normalizeWholeFile(all);
			return;
		}

		// For 'line' and 'cursor' scopes, normalize the current line.
		// We intentionally do NOT guard out if the caret is on the same line;
		// the service handles selection and caret mapping.
		try {
			svc.normalizeCurrentLine();
		} catch {
			// swallow
		}
	};

	const dispatch = async (reason: TriggerReason, scope: TriggerScope) => {
		// If a run is already in progress, just coalesce to the latest request.
		if (isRunning) {
			queued = { reason, scope };
			return;
		}

		isRunning = true;
		try {
			await runOnce(reason, scope);
		} finally {
			isRunning = false;
		}

		// If something queued while running, execute the latest one now.
		if (queued) {
			const next = queued;
			queued = null;
			// Fire and forget; serialize via isRunning
			void dispatch(next.reason, next.scope);
		}
	};

	const schedule = (reason: TriggerReason, scope: TriggerScope) => {
		if (disposed) return;
		clearTimer();
		timer = setTimeout(() => {
			timer = null;
			void dispatch(reason, scope);
		}, debounceMs) as unknown as number;
	};

	// Cursor line changed -> line only (used to be whole file; reduced to prevent duplication/races)
	if (port?.onCursorLineChanged) {
		const off = port.onCursorLineChanged(() => {
			schedule("cursor-move", "line");
		});
		unsubs.push(off);
	}

	// Enter / commit -> line only (used to be whole file; reduced)
	if (port?.onLineCommitted) {
		const off = port.onLineCommitted(() => {
			schedule("commit", "line");
		});
		unsubs.push(off);
	}

	// Leaf or file change -> whole file (keep)
	if (port?.onLeafOrFileChanged) {
		const off = port.onLeafOrFileChanged(() => {
			schedule("leaf-or-file", "file");
		});
		unsubs.push(off);
	}

	// Safety: no hooks -> single microtask tick as a one-off line format
	if (
		!port?.onLineCommitted &&
		!port?.onCursorLineChanged &&
		!port?.onLeafOrFileChanged
	) {
		setTimeout(() => schedule("manual", "line"), debounceMs);
	}

	return {
		triggerOnceNow(reason?: TriggerReason, scope?: TriggerScope) {
			const r = reason ?? "manual";
			const s = scope ?? "line";
			clearTimer();
			void dispatch(r, s);
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
