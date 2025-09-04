// Domain
export type { TaskItem, TaskParams } from "./domain/task-types";

// Service
export {
	createTaskIndexService,
	type TaskIndexService,
} from "./app/task-index-service";

// Orchestration
export { createTaskIndexOrchestrator } from "./app/task-index-orchestration";
