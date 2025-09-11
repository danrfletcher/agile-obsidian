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
