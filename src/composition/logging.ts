/** Minimal namespaced logger to keep logs consistent and searchable. */
export function createLogger(ns: string) {
	const prefix = `[${ns}]`;
	return {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
		debug: (...a: unknown[]) => console.debug(prefix, ...(a as any[])),
		// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
		info: (...a: unknown[]) => console.info(prefix, ...(a as any[])),
		// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
		warn: (...a: unknown[]) => console.warn(prefix, ...(a as any[])),
		// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
		error: (...a: unknown[]) => console.error(prefix, ...(a as any[])),
	};
}