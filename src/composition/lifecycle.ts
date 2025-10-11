/**
 * Small lifecycle helper for manual disposables that are NOT covered by plugin.registerEvent.
 * Use this for DOM listeners, timers, or any function that returns a cleanup.
 */
export type Disposer = () => void | Promise<void>;

export class DisposableStack {
	private readonly stack: Disposer[] = [];

	add<T extends Disposer>(d: T): T {
		this.stack.push(d);
		return d;
	}

	/** Adds a timeout and returns a cancel function. */
	setTimeout(fn: () => void, ms: number): Disposer {
		const id = window.setTimeout(fn, ms);
		return this.add(() => window.clearTimeout(id));
	}

	/** Adds a rAF and returns a cancel function. */
	requestAnimationFrame(fn: FrameRequestCallback): Disposer {
		const id = window.requestAnimationFrame(fn);
		return this.add(() => window.cancelAnimationFrame(id));
	}

	/** Runs all disposers LIFO. Swallows errors to avoid partial leaks. */
	disposeAll(): void {
		while (this.stack.length) {
			const d = this.stack.pop()!;
			try {
				const ret = d();
				if (ret && typeof (ret as any).then === "function") {
					// Fire and forget; composition unloading doesn't need to await
					(ret as Promise<void>).catch(() => void 0);
				}
			} catch {
				// swallow on dispose path
			}
		}
	}
}
