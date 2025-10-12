[![Buy me a coffee logo](https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExdWlscGFteGJsejlxNmQ0dzNyZGg5YzVsNDB6bXN1Z2Ewd2FoNTBiYSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9cw/McUSEJHHoZMUL99iW9/giphy.gif)](https://buymeacoffee.com/danrfletcher)

# Obsidian Agile Project Management Documentation

**Version: 1.0.0**

### Overview

Agile Obsidian is a plugin that transforms your Obsidian vault into a powerful, markdown-native Agile project management hub. It is designed for small, collaborative teams who want to own their data and manage projects, tasks, and goals directly within their notes. Inspired by tools like Jira, ClickUp, and Notion, it provides a structured yet flexible system for tracking work without leaving your knowledge base.

#### Primary use cases
-   Managing team projects with Agile artifacts like Initiatives, Epics, and Stories.
-   Creating a personal or team-wide "inbox zero" workflow for assigned tasks.
-   Tracking Objectives and Key Results (OKRs) and linking them to day-to-day work.
-   Structuring and prioritizing backlogs using established frameworks (Kano, MoSCoW).
-   Collaborating on tasks in real-time within a shared vault (requires Obsidian Relay).

#### Architecture Summary
- Host: Obsidian app
    - Loads the plugin
    - Emits file events when notes change (create, modify, delete)
- Plugin entry (main.ts)
    - Runs onload
    - Initializes dependency injection (DI) container
    - Registers settings tab, commands, views, and event listeners
- DI container (services you can think of as singletons)
    - Settings service: load/save plugin settings; expose org/team/member config
    - Command service: register and handle user-triggered commands
    - View service: register/open the Agile Dashboard view
    - Template service: insert and edit structured "chips" (initiative, epic, OKR, etc.)
    - Task indexer/parser: watch vault for changes; parse canonical task lines; keep an in‑memory index
- Commands (user entry points)
    - Open Agile Dashboard
    - Insert Template (choose initiative/epic/story/OKR, etc.)
    - Set Assignee (assign current task to a member or "everyone")
    - Set Delegate (optional reviewer/helper for a task)
- Views
    - Agile Dashboard view
        - Subscribes to task index updates
        - Filters by org/team/member
        - Lets you mark done/in progress/cancelled, snooze, reassign
- Data model (where things live)
    - Tasks and artifacts: plain Markdown lines in your vault
        - Canonical ordering of chips/metadata in a single line
    - Settings: data.json under .obsidian/plugins/agile-obsidian/
- Core flow (how updates propagate)
    - You run a command or edit via the Dashboard → plugin writes a change to a Markdown file
    - Obsidian fires a file event → task indexer re-parses affected files
    - Index is updated → Dashboard refreshes to reflect the latest state
- Boundaries/adapters
    - Obsidian API: workspace, vault, file events, view registration
    - Filesystem: read/write Markdown; no external network calls
- Persistence and privacy
    - All project/task data is in your notes
    - Plugin settings are local to the vault
    - No data leaves your machine


#### Key Capabilities Table

| Feature | Primary Value | Entry Surface | Stability |
| :--- | :--- | :--- | :--- |
| Agile Dashboard | Centralized, "inbox zero" view of all your assigned tasks. | Command, Status Bar | Stable |
| Advanced Templating Engine | Insert structured Agile artifacts and metadata with slash commands. Edit template parameters with modals & run complex template workflows. | Command | Stable |
| Org & Team Mgmt | Organize work and permissions across multiple teams. | Settings | Stable |
| Task Assignment | Assign tasks to team members with optional delegation. | Command, Agile Dashboard, UI Menu | Stable |
| Canonical Formatting | Automatically keeps task metadata consistent and parseable. | Automatic (on task edit) | Stable |

#### Other Capabilities Table

| Feature | Primary Value | Entry Surface | Stability |
| :--- | :--- | :--- | :--- |
| Inbox Zero Task Snooze | Inbox zero functionality; delay tasks (hide from dashboard) until a specified date | Agile Dashboard, task metadata | Stable |
| Task Assignment Cascade | Tasks may be implicitly assigned e.g., epic under assigned initiative. Maintains consistency when assignments are changed. | Automatic (on assignment change) | Stable |
| Task Close Cascade | Completed or cancels nested & deeply nested subtasks when the parent is cancelled | Automatic (on task close) | Stable |
| Task Close Dates | Adds completed & cancelled data metadata on task close (complete or cancel) | Automatic (on task close) | Stable |
| Agile Task Date Manager | Adds UI menu with date picker to manage start, scheduled, due & target dates | Command, Agile Dashboard, UI Menu | Experimental |
| Task Metadata Cleanup | Automated metadata cleanup e.g., removing expired snooze dates from tasks | Automatic (on Obsidian start, Agile Dashboard open) | Stable |
| Agile Task Statuses | Additional preset task statuses & custom task checkboxes [ ] → [/] → [x] → [-] | Automatic (click to advance status, long-click to cancel) | Stable |
| Custom Task Status Styles | Extended set of custom, parseable status tokens for richer workflows (Blocked, Waiting, Review, Recurring, Prioritize, One-off, Outline, etc.) | Automatic (click to advance status, status chips, stylesheet-driven) | Stable |
| Quick Insert Multiple Agile Artifacts | Press enter on a task line with an existing agile atifact e.g., Epic to insert another agile artifact e.g., Epic on the next line | Automatic (on enter click on task line with Agile artifact) | Stable |
| Right-Click Template Removal | Quickly remove templated artifacts (Initiatives, Epics, OKRs, etc.) from task lines via the native Obsidian context menu without disrupting your editing flow. | Right-click on template wrapper in editor | Stable |
| Double-Click Template Editing | Edit parameters of inserted templates (e.g., Initiative title, Epic scope) via double-click on the rendered template wrapper, opening a pre-populated modal. | Double-click on template wrapper in editor or dashboard | Stable |

### Quickstart

This guide will get you running with Agile Obsidian in under 5 minutes.

#### Prerequisites
-   Obsidian v0.15.0 or newer. (Recommended: v1.4+ for best performance).
-   Supported platforms: Desktop (Windows, macOS, Linux) and Mobile (iOS, Android).

#### Installation and setup
1.  **Install:** Open Obsidian Settings > Community Plugins > Browse. Search for "Agile Obsidian" and click **Install**, then **Enable**.
2.  **Configure Your First Team:**
    -   Navigate to Settings > Agile Obsidian.
    -   Under the "Organizations" section, click "Add Team" and give it a name (e.g., "My Team").
    -   For a quick demo, click **Load Sample Team**. This will create a folder in your vault with pre-populated notes demonstrating Initiatives, OKRs, and more.
3.  **Validation:** Open the "Sample Team" folder and look at the notes to see how Agile artifacts are structured.

#### Minimal Workflow
1.  **Create a Task:** 
    - Go to any note in the team's folder (e.g., "Initiatives") and create a new initiative. Open the Command Pallete ( `Ctrl/Cmd+P` ).
    - Type `Agile Obsidian: Insert Template: Agile - Initiative`
    - Name the initiative via the modal & click "Insert".
2.  **Assign the Task:**
    -   With your cursor on the task line, open the Command Palette ( `Ctrl/Cmd+P` ).
    -   Type `Agile Obsidian: Set Active Assignee as New Member` and press Enter.
    -   Enter your name in the modal to assign the task. You should see a `Your Name` chip appear on the line.
3.  **Open the Dashboard:**
    -   Open the Command Palette again.
    -   Type `Agile Obsidian: Open Agile Dashboard` and press Enter.
4.  **Verify:** Your task, should appear in the "Initiatives" section of the dashboard. Clicking the checkbox in the dashboard will advance the status in the team note.
5.  **Logs/Errors:** If something goes wrong, check the developer console ( `Ctrl/Cmd+Shift+I` ).

### Architecture

#### Components and responsibilities
-   **Plugin Class (`main.ts`):** The main entry point. It orchestrates the plugin's lifecycle (`onload`) and holds the central DI container.
-   **Composition Wiring (`@composition/*`):** A set of modules responsible for initializing and registering all the plugin's features (styles, settings, commands, events) with the container and Obsidian.
-   **DI Container:** A central registry for all services. This allows for loose coupling between modules (e.g., the Dashboard doesn't need to know how the Task Indexer works, it just asks the container for the indexed tasks).
-   **Task Indexer/Parser (inferred from `registerEvents`):** A service that listens for vault changes, parses Markdown files for tasks matching the canonical format, and maintains an in-memory index of all tasks for quick retrieval.
-   **Agile Dashboard (View):** A custom Obsidian View that queries the Task Indexer and renders the UI for assigned tasks. It contains its own logic for filtering, sorting, and interacting with tasks.
-   **Templating Engine:** A service that registers slash commands and manages the lifecycle of inserting and editing template "chips" in Markdown.
-   **UX Shortcuts Module:** Handles editor-level interactions like double-enter to repeat templates and right-click context menu enhancements for template management.
-   **Settings Root Module:** Manages the loading, saving, and UI for the plugin's settings tab.

#### Data flow and major sequences
*   **User Assigns a Task:**
    1.  User triggers the `Agile Obsidian: Set Assignee` command on a task line.
    2.  The Command Service handles the action, opening a modal to select a user.
    3.  On selection, the service modifies the text of the task line in the `.md` file to add the assignee chip.
    4.  The Obsidian `workspace.on('modify', ...)` event fires.
    5.  The Task Indexer service catches the event, re-parses the changed file, and updates its in-memory index.
    6.  The Agile Dashboard view, if open, is notified of the change and re-renders to display the newly assigned task.

*   **User Removes a Template via Right-Click:**
    1.  User right-clicks on a rendered template wrapper (e.g., `<span data-template-key="initiative">Initiative: Project X</span>`) in the editor.
    2.  The UX Shortcuts module captures the exact click position using Obsidian's Editor API.
    3.  The standard Obsidian "editor-menu" event fires, and the module injects a "Remove Template" item with trash icon into the context menu.
    4.  User selects "Remove Template"; the module identifies the innermost matching span, removes it from the line, and adjusts the cursor position to maintain the user's relative location.
    5.  The line is updated in-place; Obsidian fires a modify event, triggering the Task Indexer to re-parse and update the dashboard if affected.

#### Storage schemas/models
-   **Settings:** Stored in `[VAULT]/.obsidian/plugins/agile-obsidian/data.json`.
-   **Task Data:** Stored directly in `.md` files as single lines of text. The plugin relies on its "Canonical Format" to structure metadata within the line itself, rather than using frontmatter.
    -   **Format:** `[status] {parent-link} {artifact-type} {task text} {state} {tags} {assignee → delegate} {metadata} {ordered date tokens} {block ID}`
    -   **Example:** `- [ ] 🎖️ [[Initiative-Note]] Initiative: Launch v1 @alex {due:2025-10-17} ^abcdef`

### Feature Catalog

#### Feature: Agile Dashboard

-   **What you can do:**
    -   See every task assigned to you from across your entire vault in one place.
    -   Filter the view to focus on specific teams or organizations.
    -   Quickly change a task's status, snooze it for later, or reassign it to someone else.
    -   Understand your priorities at a glance with sections for Objectives, Responsibilities, and different task types.
    -   Drill down into project context by expanding parent Initiatives and Epics.

-   **When to use this feature:**
    -   Use this as your primary daily driver to decide what to work on next. It's designed for an "inbox zero" workflow where you process every item by completing, snoozing, or delegating it.

-   **Use Cases and Guided Workflows:**
    -   **Use Case U1: Daily Stand-up / Triage**
        -   **Prerequisites:** You have tasks assigned to you across various notes.
        -   **Step-by-step:**
            1.  Open the Command Palette (`Ctrl/Cmd+P`).
            2.  Run the command `Agile Obsidian: Open Agile Dashboard`.
            3.  In the "Teams selector" at the top, ensure the teams you're working on are selected.
            4.  Review the "Objectives" and "Responsibilities" sections first to address any high-level goals or blockers for your team.
            5.  Work through the "Tasks," "Stories," and "Epics" sections. For each item:
                -   If it's done, click the checkbox to mark it complete (`x`).
                -   If you can't do it today, click the "Snooze" button to hide it until tomorrow. Long-press the button to pick a specific date.
                -   If it's not your task, click the assignee chip (`@yourname`) to reassign it.
        -   **Verification:** Your dashboard should be empty or contain only items you are actively working on. The source `.md` files will be updated automatically with the new statuses and metadata.

-   **Configuration you're likely to touch:**
    -   **Teams Selector:** Controls which teams' tasks are visible. Your selection is saved automatically.
    -   **Member Filter:** Narrows the view to tasks assigned to a specific member of the selected teams.
    -   **Section Toggles (in Settings):** You can hide entire sections (e.g., "Priorities") from the dashboard if you don't use them.

#### Feature: Templating Engine

-   **What you can do:**
    -   Insert complex, structured Agile artifacts like Initiatives, Epics, User Stories, and OKRs with a simple command.
    -   Link tasks to other items in your vault, creating a web of dependencies.
    -   Add metadata like version numbers, PR links, or status tags (e.g., "Blocked," "Review").
    -   Ensure consistent formatting for all metadata.
    -   Double-click on an inserted template wrapper to edit its parameters via a pre-populated modal (e.g., update an Initiative title).
    -   Easily remove inserted templates via right-click context menu for quick iteration without disrupting your editing flow.

-   **When to use this feature:**
    -   Use this whenever you are creating a new piece of work that fits an Agile concept. Instead of typing out a title manually, use a template to get the correct formatting and icon automatically. Double-click to edit existing templates, and use right-click removal for rapid prototyping or corrections.

-   **Use Cases and Guided Workflows:**
    -   **Use Case U1: Create a New Project Initiative**
        -   **Prerequisites:** A note where you track projects.
        -   **Step-by-step:**
            1.  Create a new task line: `- [ ]`
            2.  With the cursor on that line, type `/initiative` and press Enter, or run `Agile Obsidian: Insert Template` from the Command Palette and select "Initiative".
            3.  A modal will appear asking for the "Initiative Title." Enter your project name (e.g., "Q4 Website Redesign") and submit.
            4.  A formatted chip `🎖️ Initiative: Q4 Website Redesign` will be inserted.
            5.  To create a child Epic, create a new indented task below it.
            6.  On the new line, type `/epic`, provide a title, and submit.
            7.  To edit the Initiative title later, double-click directly on the template chip to open the edit modal with pre-filled values. Make changes and submit to update the source line.
            8.  If you need to remove an incorrectly inserted template (e.g., wrong type), right-click directly on the template chip (the rendered span) and select "Remove Template" from the context menu. Your cursor will remain in place relative to the removal.
        -   **Verification:** Your note will contain a nested structure of tasks with formatted, clickable chips. Double-clicking a chip re-opens the modal to edit its parameters. Removed templates leave the task line clean, with preserved indentation and cursor position.

-   **Configuration you're likely to touch:**
    -   This feature is not directly configurable. The list of available templates is predefined within the plugin.

#### Feature: Organization & Team Management

-   **What you can do:**
    -   Create a clear hierarchy of organizations, teams, and sub-teams.
    -   Add members to each team to build your personnel directory.
    -   Define members as active or inactive to manage who is available for assignment.

-   **When to use this feature:**
    -   This is the first thing you should set up after installing the plugin. A well-defined organization is essential for task assignment and for filtering the Agile Dashboard effectively.

-   **Use Cases and Guided Workflows:**
    -   **Use Case U1: Set Up a New Company Structure**
        -   **Prerequisites:** Agile Obsidian is installed and enabled.
        -   **Step-by-step:**
            1.  Go to **Settings > Agile Obsidian**.
            2.  Under the "Organizations" section, click **Add Organization** and name it (e.g., "MyCompany").
            3.  Click the gear icon next to your new organization and select **Add Team**. Name it "Engineering".
            4.  Click the gear icon next to "Engineering" and select **Add Subteam**. Name it "Frontend".
            5.  To add a person, you can either add them directly in settings or, more practically, assign them a task. Go to a note, create a task, and run `Agile Obsidian: Set Assignee`. Choose "New Member," enter their name, and assign them. They will now appear in the settings under the relevant team.
        -   **Verification:** Your new team structure is visible in the settings tab. The members you add will be available in the assignee list for new tasks and in the member filter on the Agile Dashboard.

-   **Configuration you're likely to touch:**
    -   The entire feature is managed within the "Organizations" section of the plugin's settings tab. There are no other configuration points.

#### Feature: Task Assignment & Delegation

-   **What you can do:**
    -   Clearly define who is responsible for completing a task using the **Assignee** field.
    -   Optionally, specify a **Delegate** who may be responsible for reviewing or contributing to the task.
    -   Assign tasks to the special member "everyone" for team-wide announcements or responsibilities.
    -   Quickly reassign tasks directly from the assignee chip in the Agile Dashboard.

-   **When to use this feature:**
    -   Use this on any task that requires action from a specific person or group. Explicit assignment is the only way tasks will appear on a user's Agile Dashboard.

-   **Use Cases and Guided Workflows:**
    -   **Use Case U1: Assign a Bug Fix and Request a Review**
        -   **Prerequisites:** An "Engineering" team with members "Alex" (Developer) and "Casey" (PM) has been configured.
        -   **Step-by-step:**
            1.  In a note, create the task: `- [ ] Fix login button alignment issue`.
            2.  With the cursor on the line, run the command `Agile Obsidian: Set Assignee`. Select "Alex". The chip `@Alex` appears.
            3.  Run the command `Agile Obsidian: Set Delegate`. Select "Casey". The chip `→ @Casey` appears next to the assignee.
        -   **Verification:** The task line in your note now reads: `- [ ] Fix login button alignment issue @Alex → @Casey`. The task will appear on Alex's Agile Dashboard.

-   **Configuration you're likely to touch:**
    -   The list of available members for assignment and delegation is drawn directly from your **Organization & Team Management** settings.

#### Feature: Task Management & Canonical Formatting

-   What you can do:
    -   Manage the full lifecycle of a task using a custom, multi-stage status system.
    -   Temporarily hide tasks from your view using the "Snooze" function to maintain focus.
    -   Trust the plugin to automatically organize all metadata on a task line into a clean, consistent, and parseable order.

-   **When to use this feature:**
    -   This is the core of your daily workflow. You will use these features on every task you interact with, either in a note or in the Agile Dashboard.

-   **Use Cases and Guided Workflows:**
    -   Use Case U1: Work on and Complete a Task
        -   Prerequisites: A task is assigned to you on your dashboard.
        -   Step-by-step:
            1.  When you begin work, find the task and click its checkbox. The status changes from `[ ]` (Unstarted) to `[/]` (In Progress).
            2.  If you get blocked, you can use the Templating Engine to add a `[Blocked]` chip `/blocked` command.
            3.  Once the work is complete, click the checkbox again. The status changes to `[x]` (Done).
            4.  If you need to cancel the task at any point, long-press (or tap-and-hold on mobile) the checkbox. The status will change to `[-]` (Cancelled).
        -   Verification: The task's status symbol updates in both the dashboard and the source `.md` file. The Canonical Formatter automatically ensures any new chips (like `[Blocked]`) are placed in the correct order on the line.

-   **Configuration you're likely to touch:**
    -   The status sequence (` ` -> `/` -> `x`) and the long-press to cancel (`-`) are core behaviors and are not configurable.

##### Canonical Formatter: What it does

The Canonical Formatter restructures each task line into a consistent, parseable order while preserving indentation and your caret/selection position. Given a valid task line (e.g., `- [ ] ...`), it:

-   Extracts and reorders semantic pieces into this order:
    1.  Status prefix (`- [ ]`, `- [/]`, `- [x]`, etc.)
    2.  Parent link tag (order-tag: `parent-link`) — at most one
    3.  Artifact item type tag (order-tag: `artifact-item-type`) — at most one
    4.  Plain task text (wrappers, date tokens, arrows removed during extraction)
    5.  State chips (order-tag: `state`) — can be multiple, preserved and grouped
    6.  Other tags — sorted alphabetically by their `data-order-tag` (tags without an order-tag are placed last in this group)
    7.  Assignment:
        -   If both assignee and delegate exist: rendered as `assignee → delegate`
        -   If only delegate exists and assignee is missing: delegate is dropped
        -   "special" assignee type counts as an assignee
    8.  Metadata tags (order-tag: `metadata`) — appended after assignments
    9.  Date tokens — extracted and ordered by priority:
        -   🛫 (start) > ⏳ (hold) > 📅 (due) > 🎯 (target) > 💤 (snooze) > 💤⬇️ (snooze all) > ✅ (done) > ❌ (cancelled)
        -   Supports individual snoozes with hidden spans, folder/global snoozes, and "snooze all"
    10. Block ID (`^id`) — deduped and placed once at the end (the last standalone `^id` in the line wins)

-   Preserves indentation:
    -   Leading whitespace is preserved exactly. Normalization is applied to the content after the indentation and then indentation is re-applied.

-   Produces clean spacing:
    -   Collapses internal whitespace but preserves trailing space if it was present.
    -   Ensures a single trailing space if the line ends with a closing HTML tag (to keep the caret placement safe for further typing).

-   Keeps your caret where you expect:
    -   If you were editing in the task text, the formatter attempts to map your caret or selection to the equivalent place in the new line.
    -   Falls back to keeping the caret at the end of the line when a precise mapping isn't possible.

##### When it runs

Formatting is orchestrated per active editor view and coalesced/debounced for performance and stability.

-   On Enter / committing a line:
    -   Triggered when you press Enter (IME-safe) or when an edit increases the document's line count (e.g., paste with newline).
    -   Scope: current line.

-   On cursor moving to a different line:
    -   Triggered when the caret leaves a line (arrow keys, Home/End/PageUp/PageDown, mouse click, pointer up, or any selection change).
    -   Scope: the line you just left (previous line).

-   On file/leaf activation:
    -   Triggered when a Markdown file becomes the active view (file open or active-leaf change).
    -   Scope: the entire file for that view.
    -   Note: This does not run across the entire vault; only the currently active file is formatted on activation/startup.

-   Manual (developer utility):
    -   A probe exists on the view for diagnostics: `view.__canonicalProbe()` formats the current line immediately.

##### Performance and safety

-   Debounce: 300 ms for all triggers to avoid redundant work while you type or navigate quickly.
-   Coalescing: If a run is already in progress, newer triggers are queued and only the latest one runs afterward.
-   Re-entrancy guard: Edits made by the formatter don't retrigger the formatter.
-   Whole-file progress UI: If a whole-file format takes longer than ~1s, a progress notice appears and updates until completion. Large files are processed in small batches with cooperative yielding to keep the UI responsive.

##### What it does not do

-   It does not automatically format every file in the vault on startup. Only the currently active Markdown file is formatted when it opens or becomes active.
-   It does not change non-task lines (lines without a `- [ ]`-style prefix are left as-is).

#### Feature: Custom Task Status Styles

- **What you can do:**
  - Use an extended set of custom, parseable status tokens to express richer task states directly in your Markdown task lines.
  - Click a task's checkbox/status in the Agile Dashboard or in the editor to advance or change status where applicable.
  - Use status tokens in filters and on the Agile Dashboard to focus on work by explicit states (e.g., show only [b] Blocked items or only [r] Recurring tasks).
  - Rely on the Canonical Formatter to keep status tokens and other metadata ordered and parseable.

- **Included statuses (1.0.1):**
  - [ ] Unchecked — `[ ]` (unstarted)
  - [/] In Progress — `[/]`
  - [b] Blocked — `[b]`
  - [w] Waiting — `[w]`
  - [R] Review — `[R]`
  - [x] Regular — `[x]` (regular done state)
  - [X] Checked — `[X]` (alternate checked/done state)
  - [-] Dropped — `[-]` (cancelled/dropped)
  - [r] Recurring — `[r]`
  - [p] Prioritize — `[p]`
  - [d] One-off — `[d]`
  - [O] Outline — `[O]`

  Note: The plugin stylesheet also contains many non-essential emoji-based statuses. These are intentionally not enumerated in this documentation because they are optional visual variants and are not required for the plugin's core behavior.

- **When to use this feature:**
  - Use custom status styles when you need more nuance than simple todo/done (for example: blocking issues, items waiting on external input, items that recur, review-required tasks, or prioritization flags).
  - Use the status tokens in project triage, stand-ups, or when building filtered views on the Agile Dashboard.

- **Use Cases and Guided Workflows:**
  - **Use Case U1: Mark a task as blocked and surface it in triage**
    1. From the Agile Dashboard or the editor, set the task status to `[b]` (Blocked) using the status control or by editing the line.
    2. Filter the Dashboard to show Blocked items to prioritize unblock actions during triage.
    3. When unblocked, click the status to advance it back to `[/]` (In Progress) or to the desired state.
    - **Verification:** The source `.md` line contains `[b]` and the Dashboard filter surfaces the task under Blocked items.
  - **Use Case U2: Schedule recurring work**
    1. Create a task and tag its status as `[r]` (Recurring).
    2. Use the Agile Task Date Manager (experimental) to control recurrence dates and the plugin's metadata cleanup to maintain timestamps.
    - **Verification:** Recurring tasks appear in recurrence-aware views and are preserved as recurring rather than being permanently closed after completion.

- **Configuration you're likely to touch:**
  - Status-related behavior is mostly automatic. You may adjust Dashboard filters and Section Toggles in the settings to include/exclude custom statuses from specific views.
  - The Canonical Formatter enforces the parseable order of status tokens and other chips; you generally won't need to edit status order manually.

- **Implementation notes for maintainers:**
  - Status tokens are parsed as part of the Task Indexer's canonical line parser. When adding new tokens, ensure the parser's token map and the Canonical Formatter are updated.
  - The Dashboard and status UI should treat status tokens as first-class filters and allow click-to-advance behavior consistent with the plugin's configured status sequence behavior.

#### Feature: Template Editing & Removal

- **What you can do:**
  - Right-click on any rendered template wrapper (e.g., Initiative, Epic, OKR chips inserted via the Templating Engine) in the Obsidian editor to access a "Remove Template" option in the native context menu.
  - The feature identifies the exact template span at the click position, even in nested structures, and removes it cleanly from the task line.
  - Your cursor position is preserved relative to the removed template—e.g., if you clicked inside the template, the cursor stays at the start of where it was; if outside, it adjusts minimally.
  - Post-removal, the line is automatically cleaned up (excess spaces collapsed, respecting task/list prefixes) and the Canonical Formatter ensures consistent ordering of remaining metadata.
  - A trash icon provides clear visual feedback in the menu item.
  - For editing, use double-click on the template wrapper to open the parameter edit modal.

- **When to use this feature:**
  - Use this for quick corrections during editing sessions, such as removing a mis-inserted template type, undoing an experimental artifact, or streamlining a task line without manual span deletion. For parameter changes (e.g., updating titles), prefer double-click editing to avoid full removal.

- **Use Cases and Guided Workflows:**
  - **Use Case U1: Correct a Template Insertion Error**
    - **Prerequisites:** You have a task line with an inserted template, e.g., `- [ ] 🎖️ Initiative: Wrong Project Name`.
    - **Step-by-step:**
      1. Right-click directly on the template chip (the colored/formatted span).
      2. In the Obsidian context menu, select "Remove Template" (with trash icon).
      3. The template span is removed, leaving: `- [ ] ` (cursor preserved at the original relative position).
      4. Continue editing the plain task text or insert a corrected template via slash command. Alternatively, if you want to edit parameters without removing, double-click the template instead.
    - **Verification:** The source line updates immediately without affecting indentation or other metadata. If the dashboard is open, it reflects the change after the next index update. No manual cleanup is needed for spacing or cursor jumps.
  - **Use Case U2: Streamline Nested Artifacts**
    - **Prerequisites:** A nested structure like an Epic under an Initiative.
    - **Step-by-step:**
      1. Right-click on the child Epic template to remove just that artifact, preserving the parent Initiative.
      2. The removal adjusts the line cleanly, maintaining any assignments, dates, or statuses.
      3. For editing the remaining Initiative without removal, double-click it to access the parameter modal.
    - **Verification:** Only the targeted template is removed; the task remains parseable, and the dashboard updates accordingly.

- **Configuration you're likely to touch:**
  - This feature requires no configuration—it automatically integrates with the Templating Engine and works on any template with a `data-template-key` attribute.
  - Enabled by default; relies on the plugin's UX Shortcuts module, which is wired during plugin initialization.

- **Implementation notes for maintainers:**
  - The feature uses Obsidian's `editor-menu` event to inject the menu item dynamically, ensuring it only appears when clicking inside a valid template wrapper.
  - It handles nested `<span>` tags robustly via deterministic parsing (counting open/close tags) to target the innermost wrapper.
  - Cursor preservation uses position mapping relative to the removal range, with fallbacks for edge cases.
  - No additional commands or settings are needed; it's triggered via the existing `wireTemplatingUxShortcutsDomHandlers` call in the plugin's composition wiring.

### Configuration/Settings Reference

The Agile Obsidian settings are accessible via **Settings > Agile Obsidian**.

| Key | Type | Default | Scope | Effect |
| :--- | :--- | :--- | :--- | :--- |
| **Organizations** | `object[]` | `[]` | Global | Defines the hierarchy of teams, subteams, and members used for task assignment and dashboard filtering. |
| **Dashboard Sections** | `object` | All `true` | Global | A series of toggles (e.g., `showObjectives`, `showResponsibilities`) that control which sections are visible in the Agile Dashboard. |
| **Load Sample Team** | `button` | N/A | Global | Creates a new folder in the vault with sample notes to demonstrate plugin features. |
| **Update Teams** | `button` | N/A | Global | Forces a rebuild of the internal team/member index. Use this if the dashboard seems out of sync with your settings. |

### API Surfaces (Obsidian)

#### Commands
-   **`Agile Obsidian: Open Agile Dashboard`**
    -   **Description:** Opens the main dashboard view in a new workspace leaf.
-   **`Agile Obsidian: Insert Template`**
    -   **Description:** Opens a modal to select from a list of all available templates (e.g., Initiative, Epic, OKR) for insertion at the cursor's location.
-   **`Agile Obsidian: Set Assignee`**
    -   **Description:** Opens a modal to assign the current task to a team member. Also provides an option to create a new member.
-   **`Agile Obsidian: Set Delegate`**
    -   **Description:** Opens a modal to set a delegate for the current task.

#### Views
-   **`agile-dashboard-view`** (Internal ID, not user-facing)
    -   **How to open:** Via the `Agile Obsidian: Open Agile Dashboard` command.
    -   **State Persistence:** The view persists the user's selections for the Team and Member filters across Obsidian restarts. The folding state of items in the view is also persisted.

### Security, Privacy, Compliance

#### Data storage locations
-   All of your task and project data is stored as plain text in Markdown (`.md`) files within your own vault.
-   Plugin settings are stored locally in your vault's configuration directory at `[Your Vault]/.obsidian/plugins/agile-obsidian/data.json`.
-   This plugin does not send your data to any external servers. You fully own and control your information.

#### Permissions and data access
-   The plugin requires permission to read and write to files within your vault to update tasks.
-   It does not access the network or require any permissions outside of the Obsidian sandbox.

### Compatibility, Versioning, and Deprecations

#### Supported Obsidian versions
-   Requires Obsidian version `0.15.0` or higher.
-   The plugin is tested and maintained against the latest stable version of Obsidian.

#### Versioning
-   The current version is **1.0.0**.
-   The plugin aims to follow Semantic Versioning (SemVer). Breaking changes will be indicated by a major version increase and detailed in the release notes.

### Contributing Guide

#### Repo layout (inferred)
-   `main.ts`: Plugin entry point.
-   `manifest.json`: Plugin metadata for Obsidian.
-   `src/composition/`: Modules for wiring up the plugin's features (DI container, command registration, etc.).
-   `src/features/`: Likely location for feature-specific logic (e.g., Dashboard UI, Templating engine).
-   `src/settings/`: Logic and UI for the settings tab.
-   `src/types/`: TypeScript type definitions.

#### Build/test
-   [Needs confirmation: The build and test commands (e.g., `npm run build`, `npm run test`) need to be documented].

### Change Log (Docs)
- Documentation updated to version 1.0.1.
  - Added support and documentation for new & revised custom task status styles (see "Feature: Custom Task Status Styles").
  - Added "Custom Task Status Styles" to the Other Capabilities Table.
  - Clarified behavior and examples for blocked, waiting, recurring, review, prioritize, one-off, and outline statuses.
  - Added documentation for the new "Right-Click Template Removal" feature, including entry in Other Capabilities Table, a dedicated Feature Catalog section, updates to Templating Engine feature description and use cases, and enhancements to Architecture (Components and Data Flow).
- Previous (1.0.0) changes:
  - Documentation updated to version 1.0.0.
  - Rewrote documentation in full to align with a standardized, comprehensive structure.
  - Corrected and expanded feature descriptions based on an analysis of the plugin's architecture and existing README.
  - Added new sections for Architecture, API Surfaces, Security, and a detailed User-Centric Feature Catalog.
  - Incorporated maintainer feedback to correct command names and provide a complete feature breakdown.