import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createCanonicalFormatterOrchestrator,
	type CanonicalFormatterPort,
	type CanonicalFormatterService,
} from "@features/task-canonical-formatter";

/** G6 gating: master toggle plus the two trigger toggles decide which triggers run. */
function setup(flags: { master: boolean; onLineCommit: boolean; onLeafChange: boolean }) {
	const calls = { current: 0, line: [] as number[], whole: 0 };
	const svc: CanonicalFormatterService = {
		normalizeCurrentLine: () => {
			calls.current++;
		},
		normalizeLineNumber: (n) => {
			calls.line.push(n);
		},
		normalizeWholeFile: async () => {
			calls.whole++;
		},
	};
	const fire: { commit?: () => void; cursor?: (e: { prevLine: number; nextLine: number }) => void; leaf?: () => void } = {};
	const port: CanonicalFormatterPort = {
		getCurrentLine: () => null,
		getAllLines: () => ["- [ ] x"],
		onLineCommitted: (cb) => ((fire.commit = cb), () => {}),
		onCursorLineChanged: (cb) => ((fire.cursor = cb), () => {}),
		onLeafOrFileChanged: (cb) => ((fire.leaf = cb), () => {}),
	};
	const orch = createCanonicalFormatterOrchestrator(svc, {
		port,
		debounceMs: 10,
		shouldRun: () => flags,
	});
	return { calls, fire, orch, flags };
}

describe("canonical formatter auto triggers (G6 gating)", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("runs on line commit and on leaf change when master and both toggles are on", async () => {
		const { calls, fire } = setup({ master: true, onLineCommit: true, onLeafChange: true });
		fire.commit!();
		await vi.advanceTimersByTimeAsync(20);
		expect(calls.current).toBe(1);
		fire.cursor!({ prevLine: 4, nextLine: 5 });
		await vi.advanceTimersByTimeAsync(20);
		expect(calls.line).toEqual([4]);
		fire.leaf!();
		await vi.advanceTimersByTimeAsync(20);
		expect(calls.whole).toBe(1);
	});

	it("each trigger honours only its own toggle", async () => {
		const { calls, fire } = setup({ master: true, onLineCommit: false, onLeafChange: true });
		fire.commit!();
		fire.cursor!({ prevLine: 1, nextLine: 2 });
		await vi.advanceTimersByTimeAsync(20);
		expect(calls.current + calls.line.length).toBe(0);
		fire.leaf!();
		await vi.advanceTimersByTimeAsync(20);
		expect(calls.whole).toBe(1);

		const b = setup({ master: true, onLineCommit: true, onLeafChange: false });
		b.fire.leaf!();
		await vi.advanceTimersByTimeAsync(20);
		expect(b.calls.whole).toBe(0);
		b.fire.commit!();
		await vi.advanceTimersByTimeAsync(20);
		expect(b.calls.current).toBe(1);
	});

	it("master off: no auto trigger and no manual run", async () => {
		const { calls, fire, orch } = setup({ master: false, onLineCommit: true, onLeafChange: true });
		fire.commit!();
		fire.cursor!({ prevLine: 1, nextLine: 2 });
		fire.leaf!();
		orch.triggerOnceNow("manual", "file");
		orch.triggerOnceNow("manual", "line");
		await vi.advanceTimersByTimeAsync(50);
		expect(calls).toEqual({ current: 0, line: [], whole: 0 });
	});

	it("manual whole-file run goes through normalizeWholeFile when master is on", async () => {
		const { calls, orch } = setup({ master: true, onLineCommit: false, onLeafChange: false });
		orch.triggerOnceNow("manual", "file");
		await vi.advanceTimersByTimeAsync(5);
		expect(calls.whole).toBe(1);
	});
});
