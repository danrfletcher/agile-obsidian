/**
 * Global declaration merging for custom window events used by Agile Obsidian.
 * This enables strong typing when registering and dispatching these events.
 */
declare global {
	interface WindowEventMap {
		"agile:prepare-optimistic-file-change": CustomEvent<{
			filePath: string;
		}>;
		"agile:task-snoozed": CustomEvent<{
			uid: string;
			filePath: string;
			date?: string;
		}>;
	}
}

export {};
