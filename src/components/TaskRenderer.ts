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

  // Create container: For roots, use a ul to wrap multiple top-level items; otherwise, ul for children
  const taskList = container.createEl("ul", {
    cls: "agile-dashboard contains-task-list" + (isRoot ? "" : " children"),
    attr: {
      style: "list-style-type: none; padding-left: " + (isRoot ? "0" : "20px") + ";" // Inline: No bullets, indent children (adjust 20px as needed)
    }
  });

  tasks.forEach((task) => {
    // Skip truly blank tasks
    if (
      !task.text?.trim() &&
      !task.visual?.trim() &&
      (!task.children || task.children.length === 0)
    )
      return;

    // Create the li for this task explicitly (for better control)
    const taskItemEl = taskList.createEl("li", { cls: "task-item" });
    if (task.annotated) {
      taskItemEl.addClass("annotated-task");
    }

    // Create a temporary div to hold the rendered markdown (we'll move its children into the li)
    const tempEl = document.createElement("div");
    const renderComponent = new Component();
    MarkdownRenderer.renderMarkdown(
      (task.visual || task.text || "").trim(), // Render the markdown (which includes task list syntax)
      tempEl,
      task.link?.path || "",
      renderComponent
    );
    renderComponent.load();

    // Move the rendered content into the li (e.g., the checkbox and text)
    while (tempEl.firstChild) {
      taskItemEl.appendChild(tempEl.firstChild);
    }

    // Recurse for children: Create a new ul directly inside this li
    if (task.children && task.children.length > 0) {
      renderTaskTree(
        task.children,
        taskItemEl, // Recurse into this li
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