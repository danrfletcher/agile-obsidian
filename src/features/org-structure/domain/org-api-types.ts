import type { MemberInfo } from "./org-types";

export type MembersBuckets = {
	teamMembers: MemberInfo[];
	internalMembersDelegates: MemberInfo[];
	internalTeamDelegates: MemberInfo[];
	externalDelegates: MemberInfo[];
};

export type TeamNode = {
	teamName: string;
	teamSlug: string;
	teamFolderPath: string;
	members: MembersBuckets;
	subteams: TeamNode[];
};

export type OrganizationNode = {
	orgName: string;
	orgSlug: string;
	orgFolderPath: string;
	members: MembersBuckets;
	teams: TeamNode[]; 
};

export type OrgStructureResult = {
	organizations: OrganizationNode[];
	teams: TeamNode[];
};
