/** Minimal namespaced logger to keep logs consistent and searchable. */
export function createLogger(ns: string) {
	const prefix = `[${ns}]`;
	const c = globalThis.console;

	const debug =
		c && typeof c.debug === "function"
			? (...a: unknown[]): void => {
					c.debug(prefix, ...a);
			  }
			: (..._a: unknown[]): void => {};

	const warn =
		c && typeof c.warn === "function"
			? (...a: unknown[]): void => {
					c.warn(prefix, ...a);
			  }
			: (..._a: unknown[]): void => {};

	const error =
		c && typeof c.error === "function"
			? (...a: unknown[]): void => {
					c.error(prefix, ...a);
			  }
			: (..._a: unknown[]): void => {};

	// Map "info" to "debug" to comply with no-console rule (warn/error/debug only).
	const info = debug;

	return { debug, info, warn, error };
}