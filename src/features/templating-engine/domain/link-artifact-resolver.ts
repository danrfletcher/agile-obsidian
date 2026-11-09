/**
 * On-demand artefact-type lookup for "Workflow - Link to Artifact".
 *
 * Given a blockRef ("<file>#^<blockId>"), read the one file it names, find the line
 * carrying "^<blockId>" and infer the artefact type from the template chips on that
 * line. There is no vault index: every call reads only the target file.
 *
 * Failure policy: anything that goes wrong (file renamed/deleted, not markdown, id not
 * present, read rejects) resolves to "no type". Nothing here throws or shows a Notice.
 *
 * The target file is only ever read as text and matched with string/regex operations;
 * nothing in it is evaluated.
 */

import { getAgileArtifactType, type AgileArtifactType } from "./artifact-type";
import type { ArtifactTaskLike } from "./templates-in-tasks";

/** A vault entry as far as this lookup cares: files have an extension, folders don't. */
export type LinkTarget = { path: string; extension?: string };

/**
 * The slice of Obsidian's `App` the lookup uses. The real `App` satisfies it
 * structurally; tests pass an in-memory fake.
 */
export interface LinkArtifactApp {
	vault: {
		getAbstractFileByPath(path: string): LinkTarget | null;
		cachedRead(file: LinkTarget): Promise<string>;
	};
	metadataCache: {
		getFirstLinkpathDest(
			linkpath: string,
			sourcePath: string
		): LinkTarget | null;
	};
}

const BLOCK_MARKER = "#^";

/**
 * Split "<file part>#^<blockId>". A ref without "#^" has no block id.
 */
export function parseBlockRef(raw: unknown): {
	filePart: string;
	blockId: string;
} {
	const s = typeof raw === "string" ? raw.trim() : "";
	const idx = s.indexOf(BLOCK_MARKER);
	if (idx === -1) return { filePart: s, blockId: "" };
	return {
		filePart: s.slice(0, idx).trim(),
		blockId: s.slice(idx + BLOCK_MARKER.length).trim(),
	};
}

/**
 * Find the line that ends with "^<blockId>" (block id at the line end, trailing
 * whitespace and CRLF tolerated). Returns the raw line or undefined.
 */
export function findLineByBlockId(
	content: string,
	blockId: string
): string | undefined {
	if (!blockId) return undefined;
	const suffix = `^${blockId}`;
	for (const line of content.split(/\r?\n/)) {
		const trimmed = line.trimEnd();
		if (!trimmed.endsWith(suffix)) continue;
		const before = trimmed.slice(0, trimmed.length - suffix.length);
		if (before === "" || /\s$/.test(before)) return line;
	}
	return undefined;
}

/**
 * Reduce a raw markdown line to `{ text, status }`: list marker, checkbox and the
 * trailing block id are removed from `text`; `status` is the checkbox character for
 * task lines (undefined for plain list items and paragraphs).
 */
export function lineToTaskLike(line: string): ArtifactTaskLike {
	const match = line.match(
		/^[ \t]*(?:[-*+]|\d+[.)])\s*(?:\[(.)?\]\s*)?(.*)$/
	);
	const rawText = (match ? match[2] : line).trim();
	const rawStatus = match ? match[1] : undefined;
	const blockIdMatch = rawText.match(/\s*\^[^\s^]+$/);
	const text = blockIdMatch
		? rawText.slice(0, blockIdMatch.index).trim()
		: rawText;
	return rawStatus !== undefined ? { text, status: rawStatus } : { text };
}

function isMarkdownFile(f: LinkTarget | null | undefined): f is LinkTarget {
	return !!f && typeof f.path === "string" && f.extension === "md";
}

/**
 * Resolve the file part of a blockRef to a markdown file. Accepts:
 *  - "path/to/Note.md"
 *  - "path/to/Note"     (".md" is added)
 *  - "Note" / link text (resolved like a wiki link, relative to `sourcePath`)
 */
function resolveMarkdownFile(
	app: LinkArtifactApp,
	filePart: string,
	sourcePath: string
): LinkTarget | undefined {
	const candidates = /\.md$/i.test(filePart)
		? [filePart]
		: [filePart, `${filePart}.md`];
	for (const path of candidates) {
		const f = app.vault.getAbstractFileByPath(path);
		if (isMarkdownFile(f)) return f;
	}
	const dest = app.metadataCache.getFirstLinkpathDest(
		filePart.replace(/\.md$/i, ""),
		sourcePath
	);
	return isMarkdownFile(dest) ? dest : undefined;
}

/**
 * Read the line a blockRef points at, as `{ text, status }`.
 * Resolves to null when the target can't be found or read.
 */
export async function resolveBlockRefTarget(
	app: LinkArtifactApp,
	blockRef: unknown,
	sourcePath: string
): Promise<ArtifactTaskLike | null> {
	try {
		const { filePart, blockId } = parseBlockRef(blockRef);
		// A bare "#^id" has no file part and there is no vault scan to find it.
		if (!filePart || !blockId) return null;

		const file = resolveMarkdownFile(app, filePart, sourcePath);
		if (!file) return null;

		const content = await app.vault.cachedRead(file);
		if (typeof content !== "string") return null;

		const line = findLineByBlockId(content, blockId);
		return line === undefined ? null : lineToTaskLike(line);
	} catch {
		return null;
	}
}

/**
 * Artefact type of the block a blockRef points at, or undefined when there is none.
 * See artifactTypeOfTarget for how lines without an artefact chip are treated.
 */
export async function resolveLinkedArtifactType(
	app: LinkArtifactApp,
	blockRef: unknown,
	sourcePath: string
): Promise<AgileArtifactType | undefined> {
	const target = await resolveBlockRefTarget(app, blockRef, sourcePath);
	return target ? artifactTypeOfTarget(target) : undefined;
}

const ARTIFACT_ITEM_CHIP_RE =
	/data-order-tag\s*=\s*["']artifact-item-type["']/;

/**
 * Infer the linked type from an already-read target line, using getAgileArtifactType.
 * A type is only returned when the line carries an "artifact-item-type" chip
 * (Epic, Story, Acceptance Criteria, ...). Plain lines and lines with only
 * non-artefact chips (PR, version, Kano, MoSCoW, ...) have no type, whatever
 * getAgileArtifactType would infer for them (e.g. its "task" fallback or the
 * "kano-header" / "moscow-header" types).
 */
export function artifactTypeOfTarget(
	target: ArtifactTaskLike
): AgileArtifactType | undefined {
	try {
		if (!ARTIFACT_ITEM_CHIP_RE.test(target.text)) return undefined;
		return getAgileArtifactType(target) || undefined;
	} catch {
		return undefined;
	}
}
