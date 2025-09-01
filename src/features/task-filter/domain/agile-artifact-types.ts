import { TaskItem } from "@features/tasks";
import { getTemplateKeysFromTask } from "@features/templating";
import type { AgileArtifactType } from "./types";

/**
 * Map known template keys to canonical AgileArtifactType used by projectView.
 * Adjust keys to your actual preset ids.
 */
const TEMPLATE_KEY_TO_TYPE = Object.freeze({
	"agile.initiative": "initiative",
	"agile.learningInitiative": "learning-initiative",
	"agile.epic": "epic",
	"agile.learningEpic": "learning-epic",
	"agile.userStory": "story",
	"agile.okr": "okr",
	"agile.responsibilityRecurring": "recurring-responsibility",
} as const);

type TemplateKey = keyof typeof TEMPLATE_KEY_TO_TYPE;

/**
 * Resolve the first matching canonical type from present template keys, if any.
 * If no recognized template is present:
 * - returns "task" for non-open/done/archived items (legacy rule)
 * - returns null for open/done/archived items (preserve prior behavior)
 *
 * Note: The “task vs null” outcome for non-template items is a domain rule.
 * Keep it consistent with consumers that rely on null meaning “exclude/unknown”.
 *
 * @example
 * getAgileArtifactType(taskWithUserStoryTemplate) -> "story"
 *
 * @returns AgileArtifactType or null
 */
export const getAgileArtifactType = (
	task: TaskItem
): AgileArtifactType | null => {
	const keys = getTemplateKeysFromTask(task) as string[];
	for (const k of keys) {
		const mapped = (
			TEMPLATE_KEY_TO_TYPE as Record<
				string,
				AgileArtifactType | undefined
			>
		)[k as TemplateKey];
		if (mapped) return mapped;
	}

	// Preserve original rule: only return "task" if status is not O/d/A; else null
	if (task.status !== "O" && task.status !== "d" && task.status !== "A") {
		return "task";
	} else {
		return null;
	}
};
