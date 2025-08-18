import { TaskItem } from "src/types/TaskItem";

/**
 * Checks if a task is of a specific type based on its text content.
 * Useful for categorizing tasks into sections in projectView.
 * @param {TaskItem} task - The task to check.
 * @returns {string | null} The type of the task, or null if it doesn't match any known type.
 */
export const getTaskType = (task: TaskItem): string | null => {
	if (!task) return null;
	if (isLearningInitiative(task)) return "learning-initiative";
	if (task.text.includes("🎖️")) return "initiative";
	if (isLearningEpic(task)) return "learning-epic";
	if (task.text.includes("🏆")) return "epic";
	if (task.text.includes("📝")) return "story";
	if (isOKR(task)) return "okr";
	return "task";
};

/**
 * Checks if a task is a learning initiative based on the presence of "🎓" in the text.
 * Useful for processing personal learning initiatives separately in projectView Initiatives section.
 * @param {TaskItem} task - The task to check.
 * @returns {boolean} True if it matches learning initiative pattern, false otherwise.
 */
export const isLearningInitiative = (task: TaskItem): boolean =>
	task.text.includes("🎓");
export const isLearningEpic = (task: TaskItem): boolean =>
	task.text.includes("📚");

/**
 * Checks if a task is an OKR based on specific markup like <mark><strong>🎯 ...</strong></mark> at the start.
 * Useful for identifying and processing OKR tasks separately - e.g. in OKR filtering and subtree building in projectView's "Objectives" section.
 * @param {TaskItem} task - The task to check.
 * @returns {boolean} True if it matches OKR pattern, false otherwise.
 */
export const isOKR = (task: TaskItem): boolean => {
	if (!task.text.includes("🎯")) return false;
	const pattern = /<mark[^>]*><strong>🎯\s+.*?<\/strong><\/mark>/;
	const leadingTextPattern = /^\s*<mark[^>]*><strong>🎯\s+/;
	return pattern.test(task.text) && leadingTextPattern.test(task.text);
};

/**
 * Checks if a task is a recurring responsibility marked with 🔁 in a <mark> tag.
 * Useful for collecting recurring tasks in specific sections - e.g. in responsibilityTrees for the "Responsibilities" section in projectView.
 * @param {TaskItem} task - The task to check.
 * @returns {boolean} True if the recurring marker is present, false otherwise.
 */
export const isRecurringResponsibility = (task: TaskItem): boolean => {
	return /<mark[^>]*>\s*(<strong>)?🔁/.test(task.text);
};

/**
 * Checks if a task is an initiative, either standard (marked with 🎖️) or a learning initiative.
 * Useful for identifying and filtering initiatives in task hierarchies - e.g. in parentFinders for pruning or grouping in projectView sections like Initiatives or Tasks.
 * @param {TaskItem} t - The task to check.
 * @returns {boolean} True if it's an initiative, false otherwise.
 */
export const isInitiative = (t: TaskItem) =>
	t && (t.text.includes("🎖️") || isLearningInitiative(t)); // Assume isLearningInitiative imported

/**
 * Checks if a task is an epic, either standard (marked with 🏆) or a learning epic.
 * Useful for identifying and filtering epics in task hierarchies - e.g. in parentFinders for pruning or grouping in projectView sections like Epics or Tasks.
 * @param {TaskItem} t - The task to check.
 * @returns {boolean} True if it's an epic, false otherwise.
 */
export const isEpic = (t: TaskItem) =>
	t && (t.text.includes("🏆") || isLearningEpic(t)); // Assume isLearningEpic imported
export const isStory = (t: TaskItem) => t && t.text.includes("📝");

/**
 * Checks if a task is a basic task, excluding specific statuses and higher-level types like initiatives, epics, stories, or OKRs.
 * Useful for filtering plain actionable tasks in views - e.g. in processAndRenderTasks or other sections in projectView.
 * @param {TaskItem} task - The task to check.
 * @returns {boolean} True if it's a basic task, false otherwise.
 */
export const isTask = (task: TaskItem): boolean => {
	return (
		task.status !== "O" &&
		task.status !== "d" &&
		task.status !== "A" &&
		!isInitiative(task) &&
		!isEpic(task) &&
		!isStory(task) &&
		!isOKR(task) &&
		!isRecurringResponsibility(task)
	);
};
