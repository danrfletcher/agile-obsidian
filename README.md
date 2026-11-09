[![Buy me a coffee logo](https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExdWlscGFteGJsejlxNmQ0dzNyZGg5YzVsNDB6bXN1Z2Ewd2FoNTBiYSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9cw/McUSEJHHoZMUL99iW9/giphy.gif)](https://buymeacoffee.com/danrfletcher)

# Agile Templates

### Overview

Agile Templates is an Obsidian plugin for inserting, editing, sequencing, repeating and removing structured "template chips" (Initiatives, Epics, User Stories, OKRs, CRM stages, Kano and MoSCoW priorities, workflow states and more) on the task lines of your notes. It also keeps task lines in a consistent canonical order.

This README is a stub while the plugin is being slimmed down to its templating features; a full rewrite will follow.

### Commands and settings

- Command palette: "Insert template: <label>" for each built-in template that is allowed in the current context.
- Double-click a chip to edit its parameters; single-click a chip to open its sequence menu; right-click a chip and choose "Remove Template".
- Press Enter twice at the end of a task line that has an artifact chip to create the same template on the new line ("Double-Enter repeats template" setting).
- Settings > Agile Templates: "Double-Enter repeats template", "Enable canonical task formatter", "Run on line commit", "Run on leaf change" and a "Run canonical formatter" button.

#### Feature: Templating Engine

- **What you can do:**
  - Insert complex, structured Agile artifacts like Initiatives, Epics, User Stories, and OKRs with a simple command.
  - Link tasks to other items in your vault, creating a web of dependencies.
  - Add metadata like version numbers, PR links, or status tags (e.g., "Blocked," "Review").
  - Ensure consistent formatting for all metadata.
  - Double-click on an inserted template wrapper to edit its parameters via a pre-populated modal (e.g., update an Initiative title).
  - In the schema-based params modal (for insertion or editing), press Enter in any single-line field (inputs or selects) to submit and insert/update the template once all required fields are filled—textareas are excluded to preserve newline insertion, and blockSelect respects dropdown handling.
  - Easily remove inserted templates via right-click context menu for quick iteration without disrupting your editing flow.
  - Leverage the templating engine and params editor for seamless parameter editing, schema modals, and JSON workflows with type-safe integration.
  - Sequence templates through predefined workflows (e.g., CRM stages) via click menus; map variables and collect additional params as needed.
  - Add optional descriptions to prioritization headers (e.g., Kano - Basic, MoSCoW - Must Have) via the params modal; descriptions appear after the chip for editable context (e.g., "Kano - Basic: Enhances core usability").

- **When to use this feature:**
  - Use this whenever you are creating a new piece of work that fits an Agile concept. Instead of typing out a title manually, use a template to get the correct formatting and icon automatically. Double-click to edit existing templates, use right-click removal for rapid prototyping or corrections, and click for sequencing to advance multi-stage artifacts.

- **Use Cases and Guided Workflows:**
  - **Use Case U1: Create a New Project Initiative**
    - **Prerequisites:** A note where you track projects.
    - **Step-by-step:**
      1. Create a new task line: `- [ ]`
      2. With the cursor on that line, type `/initiative` and press Enter, or run `Insert template: Agile - Initiative` from the Command Palette.
      3. A modal will appear asking for the "Initiative Title." Enter your project name (e.g., "Q4 Website Redesign") and press Enter (or click "Insert") to submit.
      4. A formatted chip `🎖️ Initiative: Q4 Website Redesign` will be inserted.
      5. To create a child Epic, create a new indented task below it.
      6. On the new line, type `/epic`, provide a title, and press Enter (or submit) to insert.
      7. To edit the Initiative title later, double-click directly on the template chip to open the edit modal with pre-filled values. Make changes and press Enter in the field (or click "Update") to apply.
      8. If you need to remove an incorrectly inserted template (e.g., wrong type), right-click directly on the template chip (the rendered span) and select "Remove Template" from the context menu. Your cursor will remain in place relative to the removal.
      9. For multi-stage progression (e.g., Initiative → Epic → Story), click the wrapper to open a sequencing menu; select the next template to map variables and overwrite seamlessly.
      10. For prioritization, insert a header like `/kano-basic` and optionally add a description in the modal (e.g., "Focus on login flow"); it renders as `Kano - Basic: Focus on login flow` for contextual detail.
    - **Verification:** Your note will contain a nested structure of tasks with formatted, clickable chips. Double-clicking a chip re-opens the modal to edit its parameters. Removed templates leave the task line clean, with preserved indentation and cursor position. Sequencing advances the workflow without data loss. Prioritization descriptions are editable via double-click and appear inline after the header chip. Enter key submission works in single-line fields of the modal, triggering validation and insertion/editing as expected.


#### Feature: Template Sequencing

- **What you can do:**
  - Define and navigate sequences of templates (e.g., CRM pipelines: awaitingDeposit ↔ depositPaid ↔ paymentPlan ↔ paidInFull) using a floating UI menu that appears on click.
  - Automatically map variables from the current template to the target (forward/backward) for shared names; drop source-only fields and prompt for target-only *required* fields via a filtered "Additional Properties" modal (shows only absent required fields from the target schema; optional fields are omitted if missing).
  - Optionally override automatic mapping with custom transformations via `variableMapOverrides` callbacks in sequence definitions (forward/backward generics).
  - Overwrite the current template wrapper with the new one, preserving instance IDs and attributes; works in the note editor with full bidirectional ("both") support.
  - Filter menu options dynamically based on the clicked template; no explicit mapping needed for simple pass-through sequences.

- **When to use this feature:**
  - Use this for multi-stage workflows where templates represent progression (e.g., sales/CRM stages, project phases). It's ideal for editing mistakes (back) or advancing work (forward) without manual re-typing. Defaults handle most cases; add overrides only for complex transformations.

- **Use Cases and Guided Workflows:**
  - **Use Case U1: Advance a CRM Deal Stage**
    - **Prerequisites:** Preset CRM sequences are defined (e.g., awaitingDeposit → depositPaid) with optional overrides for custom logic.
    - **Step-by-step:**
      1. In a note, click on an inserted template wrapper (e.g., awaitingDeposit chip).
      2. A floating menu appears with forward options (depositPaid, paymentPlan, paidInFull) and backward options (if applicable, e.g., from paidInFull back to paymentPlan).
      3. Select "depositPaid"; shared variables (e.g., currency, totalAmount) are mapped automatically. If new *required* fields are needed (e.g., paidAmount), the "Additional Properties" modal prompts for them with pre-filled defaults where possible. Optional fields (e.g., notes) are omitted if not provided on the source.
      4. Submit to overwrite the wrapper with the depositPaid template; the source note updates.
      5. To go back (e.g., edit deposit details), click the new wrapper and select from backward options—automatic mapping reverses the flow (e.g., drop paymentPlan-specific fields like months/endDate).
    - **Verification:** The template key changes (e.g., data-template-key="depositPaid"), variables are preserved/transformed/dropped as per defaults or overrides, and the menu shows valid bidirectional sequences. No raw HTML is exposed on click. Optional fields do not trigger prompts, ensuring a streamlined flow.

- **Configuration you're likely to touch:**
  - Sequences are predefined in the plugin (e.g., CRM presets with optional `variableMapOverrides`); no user config yet. Future releases may allow custom sequences via settings or YAML. For now, defaults cover shared variables without explicit code.

- **Implementation notes for maintainers:**
  - Relies on templating-sequencer module with Sequence type (startTemplate, targetTemplate, direction: "forward"|"both", optional variableMapOverrides for forward/backward).
  - Automatic defaults in sequencer-service: pass-through for shared names, prompt missing *required* target fields only, drop extras; overrides compose atop defaults.
  - Integrates with templating-engine for rendering/prefilling and templating-params-editor for modals.
  - Generalized handler (attachCustomViewTemplatingSequencerHandler) enables reuse in custom views; uses filePath/line hints for direct overwrites without active editors. Backward navigation fixed via corrected startTemplate guards.

#### Feature: Parameterized Template Editing & Template Removal

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
    - **Verification:** The source line updates immediately without affecting indentation or other metadata. No manual cleanup is needed for spacing or cursor jumps.
  - **Use Case U2: Streamline Nested Artifacts**
    - **Prerequisites:** A nested structure like an Epic under an Initiative.
    - **Step-by-step:**
      1. Right-click on the child Epic template to remove just that artifact, preserving the parent Initiative.
      2. The removal adjusts the line cleanly, maintaining any assignments, dates, or statuses.
      3. For editing the remaining Initiative without removal, double-click it to access the parameter modal.
    - **Verification:** Only the targeted template is removed and the task remains parseable.

- **Configuration you're likely to touch:**
  - This feature requires no configuration—it automatically integrates with the Templating Engine and works on any template with a `data-template-key` attribute.
  - Enabled by default; relies on the plugin's UX Shortcuts module, which is wired during plugin initialization.

- **Implementation notes for maintainers:**
  - The feature uses Obsidian's `editor-menu` event to inject the menu item dynamically, ensuring it only appears when clicking inside a valid template wrapper.
  - It handles nested `<span>` tags robustly via deterministic parsing (counting open/close tags) to target the innermost wrapper.
  - Cursor preservation uses position mapping relative to the removal range, with fallbacks for edge cases.
  - No additional commands or settings are needed; it's triggered via the existing `wireTemplatingUxShortcutsDomHandlers` call in the plugin's composition wiring.


#### Feature: Canonical Formatting

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


### Build and test

```
npm ci
npm run build
npm run lint
npm test
```
