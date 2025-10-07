// Barrel: Public API for the task-status-sequencer feature.

export {
	DEFAULT_STATUS_SEQUENCE,
	getNextStatusChar,
	type StatusChar,
} from "./domain/task-status-sequence";

export {
	updateLineWithNextStatus,
	computeDesiredNextFromLine,
} from "./domain/task-line";

export {
	advanceTaskStatusForTaskItem,
	setTaskStatusForTaskItem,
	// Editor-line helpers (used by wiring)
	advanceTaskStatusAtEditorLine,
	setTaskStatusAtEditorLine,
} from "./app/task-status-for-task-item";

export { wireTaskStatusSequence } from "./app/wire-task-status-sequence";

export { attachCustomCheckboxStatusHandlers } from "./ui/attach-custom-checkbox-status-handlers";

export { LONG_PRESS_CANCEL_MS } from "./app/constants";

export { setCheckboxStatusChar } from "./domain/task-status-utils";

// Optional convenience re-export from platform for callers that used to import it here
export { findLineFromEvent } from "@platform/obsidian";
