import {
	App,
	Editor,
	EditorPosition,
	EditorSuggest,
	EditorSuggestContext,
	MarkdownView,
	TFile
} from "obsidian";
import { getDisplayNameFromAlias } from "../format/nameUtils";

type TargetType = "team" | "internal" | "external";
type Candidate = {
	alias: string;
	display: string;
	targetType: TargetType;
};

type Deps = {
	normalizeTaskLine: (
		line: string,
		opts?: { newDelegateMark?: string | null }
	) => string;
	renderDelegateMark: (
		alias: string,
		displayName: string,
		variant: "active" | "inactive",
		targetType: TargetType
	) => string;
	resolveTeamForPath: (filePath: string, teams: any[]) => any | null;
	isUncheckedTaskLine: (line: string) => boolean;
};

export class DelegateSlashSuggest extends EditorSuggest<Candidate> {
	private getSettings: () => any;
	private deps: Deps;

	constructor(app: App, getSettings: () => any, deps: Deps) {
		super(app);
		this.getSettings = getSettings;
		this.deps = deps;
	}

	onTrigger(
		cursor: EditorPosition,
		editor: Editor,
		_file: TFile
	): EditorSuggestContext | null {
		try {
			const line = editor.getLine(cursor.line);
			// Only trigger inside unchecked task lines
			if (!this.deps.isUncheckedTaskLine(line)) return null;
			// Suppress when task is assigned to Everyone
			if (
				/\bclass=["'][^"']*\b(?:active|inactive)-team\b[^"']*["']/i.test(
					line
				) ||
				/<strong>\s*🤝\s*Everyone\s*<\/strong>/i.test(line)
			)
				return null;

			const before = line.slice(0, cursor.ch);
			// Match "/delegate" optionally followed by a query
			const m = /(?:^|\s)\/delegate(?:\s+([^\n]*))?$/i.exec(before);
			if (!m) return null;

			const idx = before.toLowerCase().lastIndexOf("/delegate");
			if (idx === -1) return null;

			return {
				start: { line: cursor.line, ch: idx },
				end: cursor,
				query: (m[1] || "").trim().toLowerCase(),
				editor, // ADD THIS
				file: _file, // ADD THIS (TFile | null aligns with Obsidian types)
			};
		} catch {
			return null;
		}
	}

	getSuggestions(context: EditorSuggestContext): Candidate[] {
		try {
			const q = (context.query || "").toLowerCase();
			const settings = this.getSettings() || {};
			const teams: any[] = settings.teams ?? [];

			// Suppress suggestions when the current line is assigned to Everyone
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (view) {
				const ln = view.editor.getLine(
					context.start?.line ?? view.editor.getCursor().line
				);
				if (
					/\bclass=["'][^"']*\b(?:active|inactive)-team\b[^"']*["']/i.test(
						ln
					) ||
					/<strong>\s*🤝\s*Everyone\s*<\/strong>/i.test(ln)
				) {
					return [];
				}
			}

			// Build unique alias->name map across all teams
			const uniq = new Map<string, { alias: string; name: string }>();
			for (const t of teams) {
				for (const m of t.members ?? []) {
					const alias = (m.alias || "").toLowerCase();
					if (!alias) continue;
					if (!uniq.has(alias)) {
						const base = getDisplayNameFromAlias(alias);
						const name = base
							// Keep "Team" but drop the 6-char code before it
							.replace(/\s+[0-9][a-z0-9]{5}\b\s*(?=Team\b)/i, " ")
							// Otherwise drop the code and everything after it (e.g., "ext", "int")
							.replace(/\s+[0-9][a-z0-9]{5}\b.*$/i, "");
						uniq.set(alias, { alias, name });
					}
				}
			}

			// Partition into delegate-capable categories
			const vals = Array.from(uniq.values());
			const internalTeams = vals
				.filter((x) => x.alias.endsWith("-team") && x.alias !== "team")
				.map((x) => ({
					alias: x.alias,
					display: x.name,
					targetType: "team" as TargetType,
				}));
			const internalMembers = vals
				.filter((x) => x.alias.endsWith("-int"))
				.map((x) => ({
					alias: x.alias,
					display: x.name,
					targetType: "internal" as TargetType,
				}));
			const externals = vals
				.filter((x) => x.alias.endsWith("-ext"))
				.map((x) => ({
					alias: x.alias,
					display: x.name,
					targetType: "external" as TargetType,
				}));

			let all = [...internalTeams, ...internalMembers, ...externals];
			if (q) {
				all = all.filter(
					(c) =>
						c.display.toLowerCase().includes(q) ||
						c.alias.toLowerCase().includes(q)
				);
			}
			return all.slice(0, 50);
		} catch {
			return [];
		}
	}

	renderSuggestion(value: Candidate, el: HTMLElement) {
		const kind =
			value.targetType === "team"
				? "Team"
				: value.targetType === "internal"
				? "Internal"
				: "External";
		el.addClass("agile-delegate-suggest-item");
		el.setText(`Delegate to ${kind}: ${value.display}`);
	}

	selectSuggestion(value: Candidate): void {
		try {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!view) return;
			const editor = view.editor;
			const lineNo = editor.getCursor().line;
			const original = editor.getLine(lineNo);

			// Disallow when Everyone is assigned
			if (
				/\bclass=["'][^"']*\b(?:active|inactive)-team\b[^"']*["']/i.test(
					original
				) ||
				/<strong>\s*🤝\s*Everyone\s*<\/strong>/i.test(original)
			) {
				// Simply do nothing; mirrors command behavior
				return;
			}

			// Remove the typed "/delegate ..." trigger text before formatting
			let base = original;
			const ctx = this.context;
			if (ctx && ctx.start.line === lineNo) {
				const left = base.slice(0, ctx.start.ch);
				const right = base.slice(ctx.end.ch);
				base = left + right;
			}

			const cleanName = getDisplayNameFromAlias(value.alias)
				// Keep "Team" but drop the 6-char code before it
				.replace(/\s+[0-9][a-z0-9]{5}\b\s*(?=Team\b)/i, " ")
				// Otherwise drop the code and everything after it (e.g., "ext", "int")
				.replace(/\s+[0-9][a-z0-9]{5}\b.*$/i, "");
			const mark = this.deps.renderDelegateMark(
				value.alias,
				cleanName,
				"active",
				value.targetType
			);
			let updated = this.deps.normalizeTaskLine(base, {
				newDelegateMark: mark,
			});

			// Preserve a single trailing space after closing mark (Live Preview quirk)
			if (/<\/mark>\s*$/.test(updated)) {
				updated = updated.replace(/\s*$/, " ");
			}

			editor.replaceRange(
				updated,
				{ line: lineNo, ch: 0 },
				{ line: lineNo, ch: original.length }
			);
		} catch {
			/* no-op */
		}
	}
}
