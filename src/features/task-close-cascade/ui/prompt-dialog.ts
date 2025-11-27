import { PromptPort } from "../domain/ports";

const STYLE_ID = "agile-task-cascade-dialog-styles";

const CASCADE_PROMPT_CSS = `
.agile-task-cascade-backdrop {
	position: fixed;
	inset: 0;
	background: rgba(0, 0, 0, 0.35);
	z-index: 9999;
	display: flex;
	align-items: center;
	justify-content: center;
}

.agile-task-cascade-backdrop--hidden {
	display: none;
	pointer-events: none;
}

.agile-task-cascade-panel {
	background: var(--background-primary, #1e1e1e);
	color: var(--text-normal, #ddd);
	min-width: 340px;
	max-width: 520px;
	padding: 16px 18px;
	border-radius: 10px;
	box-shadow: 0 8px 30px rgba(0, 0, 0, 0.35);
	border: 1px solid var(--background-modifier-border, #444);
}

.agile-task-cascade-title {
	font-weight: 700;
	margin-bottom: 6px;
}

.agile-task-cascade-desc {
	font-size: 13px;
	margin-bottom: 12px;
}

.agile-task-cascade-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	margin: 8px 0 16px;
}

.agile-task-cascade-label {
	font-size: 13px;
}

.agile-task-cascade-buttons {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
}

.agile-task-cascade-button {
	padding: 6px 10px;
	border-radius: 6px;
	cursor: pointer;
	font-size: 13px;
}

.agile-task-cascade-button--secondary {
	background: transparent;
	color: var(--text-muted, #aaa);
	border: 1px solid var(--background-modifier-border, #444);
}

.agile-task-cascade-button--primary {
	background: var(--interactive-accent, #6c9);
	color: #000;
	border: none;
	padding: 6px 12px;
	font-weight: 600;
}
`;

function ensureCascadePromptStyles(doc: Document): void {
	if (doc.getElementById(STYLE_ID)) return;

	const styleEl = doc.createElement("style");
	styleEl.id = STYLE_ID;
	styleEl.textContent = CASCADE_PROMPT_CSS;

	if (doc.head) {
		doc.head.appendChild(styleEl);
	} else {
		doc.appendChild(styleEl);
	}
}

/**
 * Minimal DOM-based prompt asking whether to cascade to incomplete subtasks.
 * Lifecycle-safe: adds/removes elements and listeners eagerly.
 */
export class PromptDialog implements PromptPort {
	private readonly doc: Document;

	constructor(doc: Document) {
		this.doc = doc;
	}

	async askCascadeConfirm(): Promise<boolean> {
		ensureCascadePromptStyles(this.doc);

		return new Promise((resolve) => {
			// Ensure there is no lingering dialog from previous runs.
			const EXISTING_SELECTOR = '[data-agile-cascade="backdrop"]';
			for (const el of Array.from(
				this.doc.querySelectorAll(EXISTING_SELECTOR)
			)) {
				try {
					if (el instanceof HTMLElement) {
						el.classList.add("agile-task-cascade-backdrop--hidden");
					}
					el.remove();
				} catch {
					try {
						el.parentNode?.removeChild(el);
					} catch {
						/* ignore */
					}
				}
			}

			const backdrop = this.doc.createElement("div");
			backdrop.dataset.agileCascade = "backdrop";
			backdrop.classList.add("agile-task-cascade-backdrop");

			const panel = this.doc.createElement("div");
			panel.classList.add("agile-task-cascade-panel");
			panel.setAttribute("role", "dialog");
			panel.setAttribute("aria-modal", "true");
			panel.setAttribute("aria-labelledby", "agile-cascade-title");

			const title = this.doc.createElement("div");
			title.id = "agile-cascade-title";
			title.textContent = "Cascade close";
			title.classList.add("agile-task-cascade-title");

			const desc = this.doc.createElement("div");
			desc.textContent = "This task has incomplete subtasks.";
			desc.classList.add("agile-task-cascade-desc");

			const row = this.doc.createElement("label");
			row.classList.add("agile-task-cascade-row");

			const lbl = this.doc.createElement("span");
			lbl.textContent = "Close all incomplete subtasks under this task?";
			lbl.classList.add("agile-task-cascade-label");

			const input = this.doc.createElement("input");
			input.type = "checkbox";
			// Default to unchecked
			input.checked = false;
			input.setAttribute("aria-label", "Apply cascade to subtasks");

			row.appendChild(lbl);
			row.appendChild(input);

			const btns = this.doc.createElement("div");
			btns.classList.add("agile-task-cascade-buttons");

			const cancel = this.doc.createElement("button");
			cancel.textContent = "Dismiss";
			cancel.classList.add(
				"agile-task-cascade-button",
				"agile-task-cascade-button--secondary"
			);

			const confirm = this.doc.createElement("button");
			confirm.textContent = "Apply";
			confirm.classList.add(
				"agile-task-cascade-button",
				"agile-task-cascade-button--primary"
			);

			btns.appendChild(cancel);
			btns.appendChild(confirm);

			panel.appendChild(title);
			panel.appendChild(desc);
			panel.appendChild(row);
			panel.appendChild(btns);

			// Prevent any clicks inside the panel from bubbling to the backdrop.
			panel.addEventListener("click", (e) => e.stopPropagation());

			backdrop.appendChild(panel);

			const container: HTMLElement | Document =
				this.doc.body ?? this.doc;
			container.appendChild(backdrop);

			// Focus the checkbox for quick keyboard toggle
			setTimeout(() => {
				try {
					input.focus();
				} catch {
					/* ignore */
				}
			}, 0);

			function removeListener(
				el: Document,
				type: "keydown",
				handler: (this: Document, ev: KeyboardEvent) => void
			): void;
			function removeListener(
				el: HTMLElement,
				type: "click",
				handler: (this: HTMLElement, ev: MouseEvent) => void
			): void;
			function removeListener(
				el: Element | Document | Window,
				type: string,
				handler: EventListenerOrEventListenerObject
			): void {
				try {
					el.removeEventListener(type, handler);
				} catch {
					/* ignore */
				}
			}

			const cleanup = () => {
				// Immediately hide to avoid any lingering visual
				try {
					backdrop.classList.add(
						"agile-task-cascade-backdrop--hidden"
					);
				} catch {
					/* ignore */
				}
				removeListener(this.doc, "keydown", onKey);
				removeListener(confirm, "click", onConfirm);
				removeListener(cancel, "click", onCancel);
				removeListener(backdrop, "click", onBackdropClick);
				try {
					backdrop.remove();
				} catch {
					try {
						backdrop.parentNode?.removeChild(backdrop);
					} catch {
						/* ignore */
					}
				}
			};

			let resolved = false;
			const done = (value: boolean) => {
				if (resolved) return;
				resolved = true;

				// Disable buttons to prevent double-submit/re-entrancy
				try {
					confirm.disabled = true;
					cancel.disabled = true;
					panel.setAttribute("aria-busy", "true");
				} catch {
					/* ignore */
				}

				cleanup();
				resolve(value);
			};

			const onKey = (ev: KeyboardEvent) => {
				if (ev.key === "Escape") {
					ev.preventDefault();
					done(false);
				} else if (ev.key === "Enter") {
					ev.preventDefault();
					// Enter acts like Apply with current toggle state
					done(input.checked === true);
				}
			};

			const onConfirm = (e: MouseEvent) => {
				e.preventDefault();
				e.stopPropagation();
				done(input.checked === true);
			};
			const onCancel = (e: MouseEvent) => {
				e.preventDefault();
				e.stopPropagation();
				done(false);
			};
			const onBackdropClick = (e: MouseEvent) => {
				// Only close if clicking outside the panel
				if (e.target === backdrop) done(false);
			};

			confirm.addEventListener("click", onConfirm);
			cancel.addEventListener("click", onCancel);
			backdrop.addEventListener("click", onBackdropClick);
			this.doc.addEventListener("keydown", onKey);
		});
	}
}