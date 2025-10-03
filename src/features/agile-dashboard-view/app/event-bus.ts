/**
 * Typed EventBus for Agile Dashboard custom events.
 * Wraps window.dispatchEvent/addEventListener with strong payload types.
 *
 * Feature served: Cross-module communication for dashboard actions (status, snooze, template edits, assignments)
 * without coupling modules directly.
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
	constructor(private readonly target: Window = window) {}

	on<N extends EventName>(name: N, handler: Handler<N>): () => void {
		const listener = (ev: Event) => {
			const ce = ev as CustomEvent<AgileEvents[N]>;
			handler(ce.detail ?? ({} as AgileEvents[N]));
		};
		this.target.addEventListener(name as string, listener as EventListener);
		return () =>
			this.target.removeEventListener(
				name as string,
				listener as EventListener
			);
	}

	once<N extends EventName>(name: N, handler: Handler<N>): () => void {
		const listener = (ev: Event) => {
			const ce = ev as CustomEvent<AgileEvents[N]>;
			handler(ce.detail ?? ({} as AgileEvents[N]));
			this.target.removeEventListener(
				name as string,
				listener as EventListener
			);
		};
		this.target.addEventListener(name as string, listener as EventListener);
		return () =>
			this.target.removeEventListener(
				name as string,
				listener as EventListener
			);
	}

	off<N extends EventName>(name: N, handler: Handler<N>): void {
		// Note: Only useful if you saved the exact same handler reference used in on/once
		this.target.removeEventListener(
			name as string,
			handler as unknown as EventListener
		);
	}

	dispatch<N extends EventName>(name: N, payload: AgileEvents[N]): void {
		this.target.dispatchEvent(
			new CustomEvent(name as string, { detail: payload })
		);
	}
}

// Singleton for convenience
export const eventBus = new EventBus(window);
