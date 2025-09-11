export function removeWrappersByTemplate(html: string): {
	withoutWrappers: string;
	removedWrappers: string[];
} {
	// We match full template wrappers: <span data-template-wrapper="..." data-template-key="...">...</span>
	const wrapperRe =
		/<span\b[^>]*\bdata-template-key="[^"]+"[^>]*>[\s\S]*?<\/span>/gi;
	const removed: string[] = [];
	const without = html.replace(wrapperRe, (full) => {
		removed.push(full);
		return " ";
	});
	return { withoutWrappers: without, removedWrappers: removed };
}

export function findAllWrappers(html: string): string[] {
	const out: string[] = [];
	const re =
		/<span\b[^>]*\bdata-template-key="[^"]+"[^>]*>[\s\S]*?<\/span>/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(html))) {
		out.push(m[0]);
	}
	return out;
}
