import type { TaskItem } from "@features/task-index";
import { TaskButtonsDeps } from "../domain/types";
import {
	shouldShowSnoozeButton,
	shouldShowSnoozeAll,
} from "../domain/policies/eligibility";
import { snoozeAllSubtasks } from "../domain/services/snooze-all-subtasks";
import {
	hideTaskAndCollapseAncestors,
	placeInlineControlAtLineEnd,
	removeExistingControls,
} from "../ui/utils/dom";
import { createSnoozeButton } from "../ui/components/snooze-button";
import { createSnoozeAllButton } from "../ui/components/snooze-all-button"
import { getTaskFilePath } from "../domain/utils/task";

/**
 * Factory returning the public API for appending snooze buttons to task lines.
 *
 * Wiring (composition) must provide all dependencies via deps.
 */
export function createTaskButtonsAPI(deps: TaskButtonsDeps) {
	const {
		fileRepo,
		time,
		eventBus,
		artifactClassifier,
		normalizeSection,
		snoozeSingleTask,
	} = deps;

	/**
	 * Append the "Snooze" button to a task line if eligible for the section.
	 */
	async function appendSnoozeButtonIfEligible(
		task: TaskItem,
		liEl: HTMLElement,
		rawSectionType: string,
		userSlug: string
	): Promise<void> {
		const filePath = getTaskFilePath(task);
		const normalized = normalizeSection(rawSectionType);
		const artifactType = artifactClassifier(task);

		const eligible = shouldShowSnoozeButton(task, normalized, artifactType);
		if (!eligible) {
			removeExistingControls(liEl, [
				".agile-snooze-btn",
				".agile-snooze-btn-wrap",
			]);
			return;
		}

		if ((task as any)._uniqueId)
			liEl.setAttribute("data-task-uid", (task as any)._uniqueId);
		if (filePath) liEl.setAttribute("data-file-path", filePath);

		removeExistingControls(liEl, [
			".agile-snooze-btn",
			".agile-snooze-btn-wrap",
		]);

		const btn = createSnoozeButton({
			getTomorrowISO: () => time.tomorrowISO(),
			onPerform: async (dateISO: string) => {
				if (filePath && eventBus) {
					eventBus.dispatch("agile:prepare-optimistic-file-change", {
						filePath,
					});
				}
				await snoozeSingleTask(task, dateISO, userSlug);
				if ((task as any)._uniqueId && filePath && eventBus) {
					eventBus.dispatch("agile:task-snoozed", {
						uid: (task as any)._uniqueId,
						filePath,
						date: dateISO,
					});
				}
				hideTaskAndCollapseAncestors(liEl);
			},
		});

		btn.title =
			btn.title ||
			"Click: snooze until tomorrow • Long-press: enter custom date";

		placeInlineControlAtLineEnd(liEl, btn);
	}

	/**
	 * Append the "Snooze All Subtasks" button to a task line if eligible for the section.
	 */
	async function appendSnoozeAllSubtasksButtonIfEligible(
		task: TaskItem,
		liEl: HTMLElement,
		rawSectionType: string,
		userSlug: string
	): Promise<void> {
		const filePath = getTaskFilePath(task);
		const normalized = normalizeSection(rawSectionType);

		if (!shouldShowSnoozeAll(task, normalized, artifactClassifier)) return;

		if ((task as any)._uniqueId)
			liEl.setAttribute("data-task-uid", (task as any)._uniqueId);
		if (filePath) liEl.setAttribute("data-file-path", filePath);

		const btnAll = createSnoozeAllButton({
			getTomorrowISO: () => time.tomorrowISO(),
			onPerform: async (dateISO: string) => {
				if (filePath && eventBus) {
					eventBus.dispatch("agile:prepare-optimistic-file-change", {
						filePath,
					});
				}
				await snoozeAllSubtasks(
					task,
					fileRepo,
					userSlug,
					dateISO,
					new Date(time.now().setHours(0, 0, 0, 0))
				);
				// Optimistically hide children UI branches (optional: caller can refresh)
				try {
					const directWraps = Array.from(
						liEl.querySelectorAll(
							":scope > ul, :scope > div.agile-children-collapse"
						)
					) as HTMLElement[];
					directWraps.forEach((wrap) => {
						wrap.style.display = "none";
						wrap.setAttribute("aria-hidden", "true");
					});

					liEl.setAttribute("data-children-expanded", "false");
					const hit = liEl.querySelector(
						'span[data-epic-toggle-hit="true"]'
					) as HTMLElement | null;
					if (hit) hit.setAttribute("aria-expanded", "false");
					const chev = liEl.querySelector(
						'span[data-epic-toggle="true"]'
					) as HTMLElement | null;
					if (chev) chev.style.transform = "rotate(0deg)";
				} catch {
					/* ignore */
				}

				if ((task as any)._uniqueId && filePath && eventBus) {
					eventBus.dispatch("agile:task-snoozed", {
						uid: (task as any)._uniqueId,
						filePath,
						date: dateISO,
					});
				}

				hideTaskAndCollapseAncestors(liEl);
			},
		});

		placeInlineControlAtLineEnd(liEl, btnAll);
	}

	return {
		appendSnoozeButtonIfEligible,
		appendSnoozeAllSubtasksButtonIfEligible,
	};
}
