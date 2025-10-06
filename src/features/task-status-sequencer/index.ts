export {
	DEFAULT_STATUS_SEQUENCE,
	getNextStatusChar,
	updateLineWithNextStatus,
	advanceTaskStatusAtEditorLine,
	findLineFromEvent,
	computeDesiredNextFromLine,
	advanceTaskStatusByFileLine,
	advanceTaskStatusForTaskItem,
	wireTaskStatusSequence,
} from "./app/task-status-sequence";

export type { StatusChar } from "./app/task-status-sequence";

export { setCheckboxStatusChar } from "./domain/task-status-utils";
