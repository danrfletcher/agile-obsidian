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
	const debounceMs = opts?.debounceMs ?? 120;
	const port = opts?.port;

	let timer: number | null = null;
	let unsubs: Array<() => void> = [];
	let disposed = false;

	const clearTimer = () => {
		if (timer !== null) {
			clearTimeout(timer as unknown as number);
			timer = null;
		}
	};

	const guardedRun = (reason: TriggerReason, scope: TriggerScope) => {
		if (disposed) return;

		if (scope === "file") {
			const all =
				typeof port?.getAllLines === "function"
					? port.getAllLines()
					: null;
			if (!all) return;
			svc.normalizeWholeFile(all);
			return;
		}

		const applyActiveLineGuard = scope === "line";
		const cursorLine = port?.getCursorLine?.() ?? null;
		const ctx = port?.getCurrentLine?.() ?? null;

		if (
			applyActiveLineGuard &&
			cursorLine != null &&
			ctx?.lineNumber === cursorLine
		) {
			return;
		}

		svc.normalizeCurrentLine();
	};

	const schedule = (reason: TriggerReason, scope: TriggerScope) => {
		clearTimer();
		timer = setTimeout(() => {
			timer = null;
			guardedRun(reason, scope);
		}, debounceMs) as unknown as number;
	};

	// Cursor line changed -> whole file
	if (port?.onCursorLineChanged) {
		const off = port.onCursorLineChanged(() => {
			schedule("cursor-move", "file");
		});
		unsubs.push(off);
	}

	// Enter / commit -> whole file
	if (port?.onLineCommitted) {
		const off = port.onLineCommitted(() => {
			schedule("commit", "file");
		});
		unsubs.push(off);
	}

	// Leaf or file change -> whole file
	if (port?.onLeafOrFileChanged) {
		const off = port.onLeafOrFileChanged(() => {
			schedule("leaf-or-file", "file");
		});
		unsubs.push(off);
	}

	// Safety: no hooks -> single microtask tick
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
			guardedRun(r, s);
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
