/**
 * Public entry for the canonical task formatter feature.
 */

export {
	normalizeTaskLine,
	type NormalizeOptions,
} from "./domain/canonical-normalize";

export {
	createCanonicalFormatterService,
	type CanonicalFormatterService,
} from "./app/canonical-formatter-service";

export {
	createCanonicalFormatterOrchestrator,
	type CanonicalFormatterOrchestrator,
} from "./app/canonical-formatter-orchestration";

export type { CanonicalFormatterPort } from "./app/canonical-formatter-ports";

export {
	formatNoteTaskLines,
	type NoteEditorLike,
} from "./app/format-note";

export {
	planVaultReorder,
	createVaultReorderRunner,
	type VaultFileContent,
	type PlannedReorder,
	type VaultReorderHost,
	type VaultReorderResult,
} from "./app/vault-reorder";
