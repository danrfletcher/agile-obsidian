# Agile Obsidian Documentation

Version: 0.6.1  
Description: Turns Obsidian into a powerful collaborative Agile productivity hub inspired by ClickUp, Jira, and Notion. Focuses on small startup teams with features like templating, task assignment, and an Agile Dashboard for inbox-zero workflows. Free, data-owned, and Markdown-native.

## Table of Contents
- [Quick Start](#quick-start)
- [Installation](#installation)
- [Core Concepts](#core-concepts)
- [User Guide](#user-guide)
  - [Setting Up Your Organization](#setting-up-your-organization)
  - [Creating and Managing Tasks](#creating-and-managing-tasks)
  - [Using the Agile Dashboard](#using-the-agile-dashboard)
  - [Task Assignment and Delegation](#task-assignment-and-delegation)
  - [Templating Engine](#templating-engine)
  - [Advanced Features](#advanced-features)
- [Configuration and Settings](#configuration-and-settings)
- [Integrations](#integrations)
- [Troubleshooting](#troubleshooting)
- [Roadmap and Limitations](#roadmap-and-limitations)
- [Extending the Plugin](#extending-the-plugin)
- [API Reference](#api-reference) [TBD: Developer-focused, post-core docs]
- [Changelog](#changelog)
- [Contributing](#contributing)
- [Glossary](#glossary)

## Quick Start
Get up and running in under 5 minutes.

1. Install the Plugin:
   - Open Obsidian > Settings > Community Plugins > Browse.
   - Search for “Agile Obsidian” and install/enable it.
   - No prerequisites beyond Obsidian 1.0+ (recommended: 1.4+ for stability).

2. Initial Setup:
   - Go to Settings > Agile Obsidian.
   - Create your first team or organization (see Setting Up Your Organization).
   - Add the “Sample Team” from settings to familiarize yourself with agile note layouts.
   - Use the /assign command in a note to test task assignment.

3. First Workflow:
   - Open your new team’s “Initiatives” note & create a new task (- [ ]).
   - Type /initiative (or use the command palette) to insert an Agile template.
   - Assign a task: Command Palette > /assign, select a member.
   - Open the Agile Dashboard: Command Palette > “Open Agile Dashboard View”.
   - Work toward inbox zero by completing or snoozing items.

Tip:
- For teams, install Obsidian Relay for live syncing. Test in a sample vault first.

## Installation
- Via Obsidian: As above—no downloads needed.
- Via BRAT: Install BRAT in Obsidian; click “Install Beta plugin”; paste the GitHub repo for Agile Obsidian; select version; install.
- Vault Setup: No special folders required. The plugin auto-indexes & creates required team folders from settings.
- Recommended Plugins:
  - Obsidian Relay: For multiplayer editing (uses Y.js/CRDTs).
  - Highlightr: For styled assignee chips and templates.
  - Folder Notes: For folders with sub-pages

Warning:
- Obsidian Sync/Git can work for versioning, but Relay is best for real-time collaboration.
- Current limitations with Relay: edits made in the Agile Dashboard are not currently routed through Y.js transactions, so will result in merge conflicts in the differ. Workaround: keep the note & agile dashboard view open simultaneously when editing in from the view.

## Core Concepts
Agile Obsidian builds on Obsidian’s Markdown lists (tasks as “- [ ] Task text”) with Agile layers.

- Tasks: Any list item (“- [ ]”) with metadata (e.g., dates, assignees). Supports hierarchies (subtasks, parent chains).
- Agile Artifacts: Structured templates for Initiatives (projects), Epics (features), Stories (user needs), OKRs (goals), Priorities (backlog), Responsibilities (recurring duties).
- Organization Structure: Teams, subteams, members (team members, internal delegates, external delegates). Supports multiple teams per user.
- Inbox Zero Flow: Dashboard prioritizes: Objectives > Responsibilities > Tasks > Stories > Epics > Initiatives > Priorities. Snooze/complete to clear blockers.
- Metadata Canonical Format: [status] {parent-link} {artifact-type} {task text} {state} {tags} {assignee → delegate} {metadata} {ordered date tokens} {block ID}. Auto-formatted.
- Cascading Behaviors: Close/assign/snooze changes can propagate to subtasks by convention. Implicit assignments exist in notes but the dashboard renders based on explicit assignments.
- Statuses: Unstarted “ ”, In Progress “/”, Done “x”, Cancelled “-”. Click to advance; long-press to cancel.

## User Guide

### Setting Up Your Organization
Manage teams via Settings > Agile Obsidian > Organizations.

1. Add Team: “Add Team” > Name (e.g., “Engineering”).
2. Add members: Create a task in one of the team’s notes, /assign > select “New Member” to add and assign.
3. Subteams: Nest under teams for hierarchy (e.g., “Frontend” under Engineering).
4. Sample Data: Use “Load Sample Team” to import demo OKRs/Initiatives for testing.

Note:
- Members are identified by names and auto-generated slugs. External delegates don’t need Obsidian access.

### Creating and Managing Tasks
Tasks are Markdown list items. Use commands or templates.

- Insert Task: “- [ ] My Task”.
- Status:
  - Click the checkbox to advance: “ ” → “/” → “x” → “-”.
  - Long-press the checkbox to cancel (“-”) directly.
- Closing:
  - Mark “x” or “-”; completion/cancellation dates are added; can cascade to subtasks.
- Snooze:
  - In Dashboard: Click snooze button to snooze until tomorrow; long-press to choose a date.
  - In notes: Use templated commands like /snooze or dedicated date helpers (planned).
- Trees and Folding:
  - Use indentation for subtasks. Dashboard prunes to show just the relevant branches.

Example Markdown (simple):
- [ ] 🎖️ Initiative: Launch v1
  - [ ] 🏆 Epic: Authentication
    - [ ] Story: As a user, I can reset my password
      - [ ] Task: Implement reset email @alex

### Using the Agile Dashboard
Your inbox-zero hub for everything assigned to you across teams.

#### Overview
- Aggregates all explicitly assigned items from selected organizations/teams/subteams.
- Sections are rendered in this order: Objectives > Responsibilities > Tasks > Stories > Epics > Initiatives > Priorities.
- Sections auto-hide if there’s nothing to show or if you’ve turned them off in settings.

#### Initialization and Data Flow
- On Obsidian open, file add/delete, or clicking “Update Teams” in settings, Agile Obsidian rebuilds organizations/teams.
- The Teams selector defaults to “All teams” selected on first open.
- The Dashboard re-renders using a double-buffered approach for in-dashboard actions; full re-render on external note changes.

#### Controls Bar
- Teams selector: Choose orgs/teams/subteams to include.
- Member filter: Shows members from the currently selected teams.
- Active/Inactive toggle:
  - Active: Shows your active assignments.
  - Inactive: Shows your inactive assignments (deferred ownership).
- View switcher:
  - Projects: The main dashboard view (current).
  - Completed: Placeholder (coming soon).
  - Deadlines: Planned.
- State persistence: Team/member selections persist across Obsidian restarts.

#### Team and Member Selection
- Teams popup lists organizations → teams → subteams with multi-select.
- The members dropdown is the flattened set of all members from selected teams.
- If no teams are selected, the Dashboard shows a “no teams selected” empty state.
- Selections are saved and restored on restart.

#### Sections and What You’ll See
- Objectives (OKRs):
  - Shows the first incomplete objective per team for the selected member.
  - “Linked Items” lists tasks/items linked to that OKR via /linktoartifact.
- Responsibilities:
  - Recurring duties that often unblock others (e.g., weekly review).
- Tasks → Stories → Epics:
  - Increasing scope by level. Items assigned to you that typically belong to someone else’s larger work.
- Initiatives:
  - Your own projects. Expanded like other sections, but only direct Epics are shown under Initiatives to reduce clutter.
- Priorities:
  - High-level focus/backlog pointers across teams for “what’s next.”

Note:
- Sections can be toggled on/off from Settings. Even if enabled, a section hides itself if no data.

#### Interactions
- Checkboxes:
  - Click cycles status ( “ ” → “/” → “x” → “-” ).
  - Long-press cancels to “-”.
- Open source note:
  - Long-press the task text to open the task in its source note.
- Snooze buttons:
  - Shown on tasks explicitly assigned to you and on unfolded children.
  - If multiple direct children are assigned, the parent shows “Snooze all subtasks”.
  - Click to snooze until tomorrow; long-press to pick a date.
- Assignment chips:
  - Click to open reassignment UI. Cascading conventions are preserved by the assignment cascade feature.
- Template params:
  - Clicking template parameter spans opens the edit modal for that template.
- Mobile:
  - Same behaviors as desktop (tap-and-hold for long-press actions).

#### Folding and Tree Behavior
- Trees are pruned to show only relevant branches (your assignments + their parent chains).
- Expand/collapse via chevrons.
- Folding state persists across sessions.
- Initiatives show only direct Epics on expand to avoid clutter from early, non-actionable content.

Performance tips:
- Large vaults with 1000+ tasks are supported. Use team filters to keep the UI snappy.

#### Objectives (OKRs) Details
- One active OKR per team is shown (the first incomplete OKR in that team’s Objectives note for the selected member).
- Link tasks to an OKR via /linktoartifact, then select the OKR.
- Linked Items appear under the OKR to provide context for progress and dependencies.

#### What’s Included vs. Implicit
- The Dashboard displays explicitly assigned items.
- Implicit assignments exist in notes by convention (inheritance up the parent chain) and are handled during reassignment cascades, but they are not used as the source for Dashboard inclusion.

#### Example: Daily Inbox-Zero Sweep
1. Objectives: Review your single visible OKR per team; view team’s progress through any linked items assigned to other members.
2. Responsibilities: Clear routine tasks to unblock others.
3. Tasks/Stories/Epics: Work through these components of other team member’s initiatives assigned to you; complete or snooze.
4. Initiatives: Make progress on your own projects once blockers are cleared.
5. Priorities: If you reach zero, look here to decide what’s next.

Screenshot placeholders:
- Controls bar with Teams selector and Active toggle.
- An Initiative expanded to one Epic, with a Story and assigned Task visible.

### Task Assignment and Delegation
- Use /assign to set a single assignee and optionally a delegate per task.
- Special “everyone” assignment is supported for team-wide responsibilities.
- Reassign by clicking the assignee chip in Dashboard; cascades preserve implicit assignment conventions in notes.

### Templating Engine
- Insert artifacts via commands (e.g., /initiative, /epic, /story, /okr).
- Templates support parameters (titles, details, colors) with modals for editing.
- Use /linktoartifact to link tasks to OKRs and other artifacts.

### Advanced Features
- Snooze All Subtasks: Appears on parents with multiple assigned children visible.
- Canonical Formatting: Enforces consistent metadata ordering automatically.
- Close Cascade: Completing a parent can complete children.
- Status Sequencer: Custom checkbox cycle and long-press cancel.

## Configuration and Settings
- Sections visibility: Toggle Objectives, Responsibilities, Tasks, Stories, Epics, Initiatives, Priorities.
- Organizations & Teams:
  - Create orgs/teams/subteams, add members.
  - “Update Teams” rebuilds the hierarchy used by the Dashboard.
- Persistence:
  - Team/member selections in the Dashboard persist across restarts.
- Recommended defaults:
  - Keep Objectives and Responsibilities on for founders and leads.
  - Start in Active view; check Inactive when you reach inbox zero.

## Troubleshooting
- Dashboard is empty:
  - Ensure you have at least one team selected in the Teams selector.
  - Confirm items are explicitly assigned to you; implicit-only items won’t appear.
- Snooze buttons missing:
  - Only appear on tasks explicitly assigned to you and on unfolded child items; “Snooze all” appears when multiple visible children are assigned.
- Initiatives show no children:
  - Only Epics are displayed under Initiatives to reduce clutter.
- Relay/Git conflicts:
  - Editing from the Dashboard and notes simultaneously can cause merge conflicts. Best practice: have both the Dashboard and the relevant note open. A broader fix is in progress in collaboration with Relay devs.

## Roadmap and Limitations
Highlights relevant to the Dashboard and workflows:
- Planned Views: Completed overhaul; Deadlines; Inactive view improvements (show snoozed then inactive).
- Dashboard UX:
  - Remove snooze buttons from unfolded non-target tasks (only on filtered targets).
  - Click-to-edit task text and add dates/templates inline.
  - Remember folding state for notes on external changes.
  - Persistent drag-to-reorder items and sections.
- Features:
  - Blocker cascade (bubble up blockers/waiting states).
  - Date picker commands (/due, /scheduled, /start, /target).
  - Responsibilities counters (e.g., 3/10 this month).
  - Delegated section and Chat section.
- Limitations:
  - Dashboard uses explicit assignments; implicit assignments remain a note convention.
  - Real-time collaboration best with Relay; be mindful of potential conflicts when editing from multiple surfaces.

## Extending the Plugin
- Templating & Automation SDK (planned): Create custom templates and automations.
- Hot-folder (planned): Auto-generate commands from a designated folder.

## API Reference
TBD after core docs are finalized.

## Changelog
See versions.json and Git tags for history.

## Contributing
- Issues and feature requests are welcome.
- Please include reproduction steps and sample Markdown when reporting bugs related to parsing or indexing.

## Glossary
- Explicit Assignment: Directly assigned item to a member (shown in Dashboard).
- Implicit Assignment: Inferred assignment via parent chain in notes (not used for Dashboard inclusion).
- OKR: Objective and Key Results, shown one active per team for the selected member.
- Snooze: Temporarily hide an item until a date; long-press to pick a date; “snooze all” for parents with multiple visible assigned children.
- Responsibilities: Recurring duties that often unblock others.
- Priorities: High-level “what’s next” across teams.