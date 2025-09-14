/**
 * UI policy primitives for Agile Dashboard sections.
 * Centralizes shared section normalization logic and section typing.
 */

export type TaskSection =
	| "objectives"
	| "responsibilities"
	| "priorities"
	| "initiatives"
	| "epics"
	| "stories"
	| "tasks";

export interface TaskUIPolicy {
	section: TaskSection;
}

/**
 * Normalize a free-form section type string into a TaskSection value.
 * Unknown values default to "tasks".
 */
export function normalizeSection(sectionType: string): TaskSection {
	const s = (sectionType || "").toLowerCase();
	if (s.includes("objective")) return "objectives";
	if (s.includes("responsibil")) return "responsibilities";
	if (s.includes("priorit")) return "priorities";
	if (s.includes("initiative")) return "initiatives";
	if (s.includes("epic")) return "epics";
	if (s.includes("story")) return "stories";
	return "tasks";
}
