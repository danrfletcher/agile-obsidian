import type AgileObsidianPlugin from "src/main";
import type { TaskIndexService } from "@features/task-index/app/task-index-service";

import type { Container } from "src/composition/container";

export function getTaskIndexServiceFromContainer(
	plugin: AgileObsidianPlugin
): TaskIndexService | undefined {
	const container = (plugin as unknown as { container: Container }).container;
	return container?.taskIndexService;
}
