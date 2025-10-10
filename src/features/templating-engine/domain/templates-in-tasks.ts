import { TaskItem } from "@features/task-index";

/**
 * Extract all data-template-key values from the task HTML.
 * Matches elements like:
 *   <span... data-template-key="agile.userStory" ...>...</span>
 */
const TEMPLATE_KEY_REGEX = /data-template-key\s*=\s*"([^"]+)"/g;

export function getTemplateKeysFromTask(
	task: TaskItem | null | undefined
): string[] {
	if (!task?.text) return [];
	const keys: string[] = [];
	let m: RegExpExecArray | null;
	while ((m = TEMPLATE_KEY_REGEX.exec(task.text)) !== null) {
		keys.push(m[1]);
	}
	return keys;
}
