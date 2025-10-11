/** Minimal namespaced logger to keep logs consistent and searchable. */
export function createLogger(ns: string) {
	const prefix = `[${ns}]`;
	return {
		debug: (...a: any[]) => console.debug(prefix, ...a),
		info: (...a: any[]) => console.info(prefix, ...a),
		warn: (...a: any[]) => console.warn(prefix, ...a),
		error: (...a: any[]) => console.error(prefix, ...a),
	};
}
