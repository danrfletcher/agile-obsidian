import { TaskItem } from "../types/TaskItem";
import { isOKR } from "./taskFilters";

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

export const isLearningInitiative = (task: TaskItem): boolean =>
	task.text.includes("🎓");
export const isLearningEpic = (task: TaskItem): boolean =>
	task.text.includes("📚");
