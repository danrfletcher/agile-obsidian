/**
 * Typed EventBus for Agile Dashboard custom events.
 * Wraps window.dispatchEvent/addEventListener with strong payload types and simple lifecycle.
 *
 * Purpose:
 * - Decouple UI modules and the view via well-defined events.
 * - Make event usage type-safe and easy to test (by overriding the target).
 */

export type AgileEvents = {
	"agile:prepare-optimistic-file-change": { filePath: string };
	"agile:task-status-updated": {
		uid?: string;
		filePath?: string;
		newStatus?: string;
	};
	"agile:task-snoozed": { uid?: string; filePath?: string; date?: string };
	"agile:task-updated": { filePath?: string };

	"agile:assignee-changed": {
		filePath: string;
		parentLine0: number;
		beforeLines?: string[] | null;
		newAssigneeSlug: string | null;
		oldAssigneeSlug?: string | null;
		parentUid?: string | null;
	};
	"agile:assignment-changed": {
		uid: string;
		filePath: string;
		newAlias: string;
	};
	"agile:request-assign-propagate": { uid: string; newAlias: string };
};

type EventName = keyof AgileEvents;
type Handler<N extends EventName> = (payload: AgileEvents[N]) => void;

export class EventBus {
	constructor(
		private readonly target:
			| Window
			| Pick<
					Window,
					"addEventListener" | "removeEventListener" | "dispatchEvent"
			  >
			| null = typeof window !== "undefined" ? window : null
	) {}

	on<N extends EventName>(name: N, handler: Handler<N>): () => void {
		if (!this.target) return () => {};
		const listener = (ev: Event) => {
			const ce = ev as CustomEvent<AgileEvents[N]>;
			handler(ce.detail ?? ({} as AgileEvents[N]));
		};
		this.target.addEventListener(name as string, listener as EventListener);
		return () =>
			this.target?.removeEventListener?.(
				name as string,
				listener as EventListener
			);
	}

	once<N extends EventName>(name: N, handler: Handler<N>): () => void {
		if (!this.target) return () => {};
		const listener = (ev: Event) => {
			const ce = ev as CustomEvent<AgileEvents[N]>;
			handler(ce.detail ?? ({} as AgileEvents[N]));
			this.target?.removeEventListener?.(
				name as string,
				listener as EventListener
			);
		};
		this.target.addEventListener(name as string, listener as EventListener);
		return () =>
			this.target?.removeEventListener?.(
				name as string,
				listener as EventListener
			);
	}

	off<N extends EventName>(name: N, handler: Handler<N>): void {
		// Note: Off only works if the same reference used in `on` is provided here.
		if (!this.target) return;
		this.target.removeEventListener(
			name as string,
			handler as unknown as EventListener
		);
	}

	dispatch<N extends EventName>(name: N, payload: AgileEvents[N]): void;

	dispatch(name: string, payload?: unknown): void;
	dispatch(name: string, payload?: unknown): void {
		if (!this.target) return;
		this.target.dispatchEvent(
			new CustomEvent(name, { detail: payload })
		);
	}
}

// Singleton for convenience (no-SSR safe)
export const eventBus = new EventBus(
	typeof window !== "undefined" ? window : null
);