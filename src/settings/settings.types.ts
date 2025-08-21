export type MemberType =
	| "member"
	| "external"
	| "team"
	| "internal-team-member";

export interface MemberInfo {
	alias: string;
	name: string;
	type?: MemberType;
}

export interface TeamInfo {
	name: string;
	rootPath: string;
	members: MemberInfo[];
	slug?: string;
}

export interface AgileObsidianSettings {
	showObjectives: boolean;
	showTasks: boolean;
	showStories: boolean;
	showEpics: boolean;
	showInitiatives: boolean;
	showResponsibilities: boolean;
	showPriorities: boolean;
	useBundledCheckboxes: boolean;
	currentUserAlias: string | null;
	teams: TeamInfo[];
}
