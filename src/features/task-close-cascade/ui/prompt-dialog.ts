import { PromptPort } from "../domain/ports";

/**
 * Minimal DOM-based prompt asking whether to cascade to incomplete subtasks.
 * Lifecycle-safe: adds/removes elements and listeners eagerly.
 */
export class PromptDialog implements PromptPort {
	async askCascadeConfirm(): Promise<boolean> {
		return new Promise((resolve) => {
			// Ensure there is no lingering dialog from previous runs.
			const EXISTING_SELECTOR = '[data-agile-cascade="backdrop"]';
			for (const el of Array.from(
				document.querySelectorAll(EXISTING_SELECTOR)
			)) {
				try {
					(el as HTMLElement).style.display = "none";
					el.remove();
				} catch {
					try {
						el.parentNode?.removeChild(el);
					} catch {
						/* ignore */
					}
				}
			}

			const backdrop = document.createElement("div");
			backdrop.dataset.agileCascade = "backdrop";
			backdrop.style.position = "fixed";
			backdrop.style.inset = "0";
			backdrop.style.background = "rgba(0,0,0,0.35)";
			backdrop.style.zIndex = "9999";
			backdrop.style.display = "flex";
			backdrop.style.alignItems = "center";
			backdrop.style.justifyContent = "center";

			const panel = document.createElement("div");
			panel.style.background = "var(--background-primary, #1e1e1e)";
			panel.style.color = "var(--text-normal, #ddd)";
			panel.style.minWidth = "340px";
			panel.style.maxWidth = "520px";
			panel.style.padding = "16px 18px";
			panel.style.borderRadius = "10px";
			panel.style.boxShadow = "0 8px 30px rgba(0,0,0,0.35)";
			panel.style.border =
				"1px solid var(--background-modifier-border, #444)";
			panel.setAttribute("role", "dialog");
			panel.setAttribute("aria-modal", "true");
			panel.setAttribute("aria-labelledby", "agile-cascade-title");

			const title = document.createElement("div");
			title.id = "agile-cascade-title";
			title.textContent = "Cascade Close";
			title.style.fontWeight = "700";
			title.style.marginBottom = "6px";

			const desc = document.createElement("div");
			desc.textContent = "This task has incomplete subtasks.";
			desc.style.fontSize = "13px";
			desc.style.marginBottom = "12px";

			const row = document.createElement("label");
			row.style.display = "flex";
			row.style.alignItems = "center";
			row.style.justifyContent = "space-between";
			row.style.gap = "12px";
			row.style.margin = "8px 0 16px";

			const lbl = document.createElement("span");
			lbl.textContent = "Close all incomplete subtasks under this task?";
			lbl.style.fontSize = "13px";

			const input = document.createElement("input");
			input.type = "checkbox";
			// Default to unchecked
			input.checked = false;
			input.setAttribute("aria-label", "Apply cascade to subtasks");

			row.appendChild(lbl);
			row.appendChild(input);

			const btns = document.createElement("div");
			btns.style.display = "flex";
			btns.style.justifyContent = "flex-end";
			btns.style.gap = "8px";

			const cancel = document.createElement("button");
			cancel.textContent = "Dismiss";
			cancel.style.background = "transparent";
			cancel.style.color = "var(--text-muted, #aaa)";
			cancel.style.border =
				"1px solid var(--background-modifier-border, #444)";
			cancel.style.padding = "6px 10px";
			cancel.style.borderRadius = "6px";
			cancel.style.cursor = "pointer";

			const confirm = document.createElement("button");
			confirm.textContent = "Apply";
			confirm.style.background = "var(--interactive-accent, #6c9)";
			confirm.style.color = "#000";
			confirm.style.border = "none";
			confirm.style.padding = "6px 12px";
			confirm.style.borderRadius = "6px";
			confirm.style.cursor = "pointer";
			confirm.style.fontWeight = "600";

			btns.appendChild(cancel);
			btns.appendChild(confirm);

			panel.appendChild(title);
			panel.appendChild(desc);
			panel.appendChild(row);
			panel.appendChild(btns);

			// Prevent any clicks inside the panel from bubbling to the backdrop.
			panel.addEventListener("click", (e) => e.stopPropagation());

			backdrop.appendChild(panel);
			document.body.appendChild(backdrop);

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
					(backdrop as HTMLElement).style.display = "none";
					(backdrop as HTMLElement).style.pointerEvents = "none";
				} catch {
					/* ignore */
				}
				removeListener(document, "keydown", onKey);
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
			document.addEventListener("keydown", onKey);
		});
	}
}
