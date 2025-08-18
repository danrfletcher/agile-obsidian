# Utils overview

Brief purpose of each utility file and suggested categories for organizing them.

## File summaries

- childUtils.ts
  - Helpers for working with task children/descendants: traversals, collecting descendants, mapping child arrays, and checking leaf nodes when rendering or filtering trees.

- config.ts
  - Central place for user/plugin configuration values and constants (e.g., current user name used to derive a slug). Keeps config access consistent across the codebase.

- dateUtils.ts
  - Date helpers: parsing and formatting YYYY-MM-DD, local date comparisons (ignore time), “is relevant today” checks, and building simple date ranges.

- hierarchyUtils.ts
  - Task tree utilities: building/pruning tree structures, flattening, creating parent/child maps, and helpers like `stripListItems` to drop non-task headers from lists before rendering.

- snooze.ts
  - Low-level, single-task snoozing logic. Mutates the exact line in a file to add/replace a snooze marker, using a user-specific hidden span and defaulting to “tomorrow” if no date is supplied.

- snoozeUtils.ts
  - Higher-level snooze helpers: cleaning up expired snoozes across many tasks/files, regex-safe helpers, and utilities like `slugifyName` used by snooze workflows.

- taskFilters.ts
  - Predicate-style filters used across sections: assignment checks, sleeping/cancelled checks, status-based gating, and other composable filters used during rendering.

- taskTypes.ts
  - Classification helpers to determine semantic task types (e.g., responsibilities vs learning initiatives/epics) based on emojis/markers or metadata.

## Suggested categories (and mapping)

- Configuration
  - config.ts

- Dates and scheduling
  - dateUtils.ts

- Task trees and hierarchy
  - hierarchyUtils.ts
  - childUtils.ts

- Snoozing
  - snooze.ts
  - snoozeUtils.ts

- Task filtering and classification
  - taskFilters.ts
  - taskTypes.ts

If you want to physically group files, consider subfolders reflecting these categories:
- src/utils/config/
- src/utils/dates/
- src/utils/hierarchy/
- src/utils/snooze/
- src/utils/tasks/
(then re-export via a barrel file if you want to preserve import ergonomics).
