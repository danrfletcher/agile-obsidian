import type AgileObsidianPlugin from "src/main";
import type { TaskIndexService } from "@features/task-index/app/task-index-service";

export function getTaskIndexServiceFromContainer(
	plugin: AgileObsidianPlugin
): TaskIndexService | undefined {
	const container: any = plugin.container;
	return container?.taskIndexService as TaskIndexService | undefined;
}
