import {
  App,
  Component,
  MarkdownRenderer,
  TFile,
} from "obsidian";
import { TaskItem } from "../types/TaskItem";

// Shared tree renderer (used by all sections)
export function renderTaskTree(
  tasks: TaskItem[],
  container: HTMLElement,
  app: App,
  depth: number,
  isRoot: boolean,
  sectionType: string // Kept for potential future use, but sections can override
) {
  // Skip if no tasks
  if (tasks.length === 0) return;

  // Create container (ul for lists, div for root to avoid top-level issues)
  const taskContainer = isRoot
    ? container.createEl("div", { cls: "agile-dashboard" })
    : container.createEl("ul", {
        cls: "agile-dashboard children contains-task-list",
      }); // Add contains-task-list for Obsidian styling

  tasks.forEach((task) => {
    // Skip truly blank tasks
    if (
      !task.text?.trim() &&
      !task.visual?.trim() &&
      (!task.children || task.children.length === 0)
    )
      return;

    // Create a temporary div to hold the rendered markdown (we'll move its children)
    const tempEl = document.createElement("div");
    const renderComponent = new Component();
    MarkdownRenderer.renderMarkdown(
      (task.visual || task.text || "").trim(), // Render the markdown (which includes task list syntax)
      tempEl,
      task.link?.path || "",
      renderComponent
    );
    renderComponent.load();

    // Append the rendered content directly to taskContainer (no extra li/checkbox)
    while (tempEl.firstChild) {
      const child = tempEl.firstChild;
      taskContainer.appendChild(child);
      // Apply classes to the generated <li> for styling
      if (child instanceof HTMLElement && child.tagName === "LI") {
        child.addClass("task-item");
        // Handle annotations if needed
        if (task.annotated) {
          child.addClass("annotated-task");
        }
      }
    }

    // Recurse for children: Append a new ul under the last rendered li (if any)
    if (task.children && task.children.length > 0) {
      const lastLi = taskContainer.querySelector("li:last-child"); // Attach to the rendered li
      const childrenContainer = (lastLi || taskContainer).createEl("ul", {
        cls: "children contains-task-list",
      });
      renderTaskTree(
        task.children,
        childrenContainer,
        app,
        depth + 1,
        false,
        sectionType
      );
    }
  });
}

// Shared status change handler (used by sections that need checkboxes/interactivity)
export const handleStatusChange = async (
  task: TaskItem,
  app: App,
  isCancel = false
): Promise<void> => {
  try {
    const currentStatus = task.status || " ";
    let newStatus = currentStatus;

    if (isCancel) {
      newStatus = "-";
    } else {
      if (currentStatus === " ") newStatus = "/";
      else if (currentStatus === "/" || currentStatus === "d")
        newStatus = "x";
      else return;
    }

    const file = app.vault.getAbstractFileByPath(task.link.path) as TFile;
    if (!file) throw new Error(`File not found: ${task.link.path}`);

    const content = await app.vault.read(file);
    const escapedTaskText = task.text.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

    const taskLineRegex = new RegExp(
      `^(\\s*[-*]\\s*)\\[\\s*${currentStatus}\\s*\\]\\s*(${escapedTaskText})\\s*$`,
      "gm"
    );

    const newContent = content.replace(
      taskLineRegex,
      (match, prefix, textPart) => {
        let updatedLine = `${prefix}[${newStatus}] ${textPart}`;
        if (newStatus === "x" && !isCancel) {
          const today = new Date().toISOString().split("T")[0];
          const completionMarker = ` ✅ ${today}`;
          if (!/\s$/.test(updatedLine)) updatedLine += " ";
          updatedLine += completionMarker;
        }
        return updatedLine;
      }
    );

    if (newContent === content)
      throw new Error("No matching task line found");

    await app.vault.modify(file, newContent);
  } catch (error) {
    console.error("Error updating task status:", error);
  }
};