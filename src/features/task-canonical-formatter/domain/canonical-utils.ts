export function extractPrefix(line: string): {
	prefix: string | null;
	rest: string;
} {
	const m = /^(\s*[-*]\s*\[\s*.\s*\]\s*)([\s\S]*)$/.exec(line);
	if (!m) return { prefix: null, rest: line };
	return { prefix: m[1], rest: m[2] };
}

export function extractBlockId(rest: string): {
	restSansBlockId: string;
	blockId: string | null;
} {
	let blockId: string | null = null;
	const newRest = rest.replace(
		/\s*\^([A-Za-z0-9-]+)\s*$/g,
		(_full, id: string) => {
			blockId = `^${id}`;
			return " ";
		}
	);
	return { restSansBlockId: newRest, blockId };
}

// Collapse runs of whitespace inside but DO NOT strip trailing space.
// Keep leading/trailing as-is, except collapse inner multiples to single.
export function normalizeWhitespacePreserveTrailing(s: string): string {
	const endsWithSpace = /\s$/.test(s);
	// Collapse internal runs of whitespace to single spaces
	let out = s.replace(/\s{2,}/g, " ");

	// If the original ended with whitespace but replacement lost it, restore one.
	if (endsWithSpace && !/\s$/.test(out)) {
		out += " ";
	}
	return out;
}

// When line ends with a closing HTML tag or </mark>, ensure a trailing space.
// Otherwise, do not forcibly trim trailing spaces.
export function ensureSafeTrailingSpaceForHtml(out: string): string {
	const endsWithClosingTag = />\s*$/.test(out) || /<\/mark>\s*$/i.test(out);

	if (endsWithClosingTag) {
		// Ensure exactly one space at the end
		return out.replace(/\s*$/, " ");
	}
	// Otherwise, allow whatever trailing whitespace is already there.
	return out;
}

// cheap dom-less attribute grabs on wrappers
export function getAttr(html: string, name: string): string | undefined {
	const re = new RegExp(`\\b${name}="([^"]*)"`);
	const m = re.exec(html);
	return m ? m[1] : undefined;
}

export function collectDataProps(wrapper: string): Record<string, string> {
	const props: Record<string, string> = {};
	// data-<kebab>="<value>"
	const re = /\bdata-([a-z0-9-]+)="([^"]*)"/gi;
	let match: RegExpExecArray | null;
	while ((match = re.exec(wrapper))) {
		const key = match[1];
		const val = match[2];
		props[key] = val;
	}
	return props;
}

// Extract inner html inside wrapper
export function extractInnerHtml(wrapper: string): string {
	const m = /^<span\b[^>]*>([\s\S]*?)<\/span>$/i.exec(wrapper.trim());
	return m ? m[1] : wrapper;
}
