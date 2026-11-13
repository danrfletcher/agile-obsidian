/**
 * Minimal view of a task line the artefact-type inference needs:
 * the line text (list marker, checkbox and trailing block id already stripped)
 * and, for tasks, the checkbox status character.
 */
export type ArtifactTaskLike = { text: string; status?: string };

/**
 * Extract all data-template-key values from the task HTML.
 * Matches elements like:
 *   <span... data-template-key="agile.userStory" ...>...</span>
 */
const TEMPLATE_KEY_REGEX = /data-template-key\s*=\s*"([^"]+)"/g;

export function getTemplateKeysFromTask(
	task: ArtifactTaskLike | null | undefined
): string[] {
	if (!task?.text) return [];
	const keys: string[] = [];
	let m: RegExpExecArray | null;
	TEMPLATE_KEY_REGEX.lastIndex = 0;
	while ((m = TEMPLATE_KEY_REGEX.exec(task.text)) !== null) {
		keys.push(m[1]);
	}
	return keys;
}
