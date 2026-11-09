export interface AgileObsidianSettings {
	/**
	 * Default templates: the 44 built-in templates are available (insert commands,
	 * sequence menus, double-Enter repeat). When off, the built-in insert commands are
	 * removed and built-ins drop out of sequence menus and repeat; chips already in
	 * notes are never touched and Remove Template keeps working.
	 * Default: true
	 */
	enableDefaultTemplates: boolean;

	/**
	 * UI fold state for UX Shortcuts section (persisted).
	 * Default: true (minimized)
	 */
	uiFoldUxShortcuts: boolean;

	/**
	 * UX Shortcuts: Enables double-Enter to quickly repeat the same agile artifact
	 * template on the next task line.
	 * Default: true
	 */
	enableUxRepeatAgileTemplates: boolean;

	/**
	 * UI fold state for Agile Task Formatting section (persisted).
	 * Default: true (minimized)
	 */
	uiFoldAgileTaskFormatting: boolean;

	/**
	 * Canonical formatter controls
	 */
	enableTaskCanonicalFormatter: boolean; // Master enable/disable
	enableCanonicalOnLineCommit: boolean; // Format last line when cursor changes line
	enableCanonicalOnLeafChange: boolean; // Format entire file on leaf/file change
}
