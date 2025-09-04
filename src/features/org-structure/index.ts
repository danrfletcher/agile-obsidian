// Public API for the org-structure feature
export { buildTeamSlug } from "./domain/org-slugs";
export { registerOrgStructureSettings } from "./app/org-structure-settings-orchestration";
export * from "./domain/org-types";

// New exports: public API types and service + helpers
export type * from "./domain/org-api-types";
export {
	createOrgStructureService,
	type OrgStructurePort,
	// Pure helpers for UI
	bucketizeMembers,
	classifyMember,
	computeOrgStructureView,
	toOrgStructureResult,
	buildTeamNode,
	computeDirectChildrenMap,
} from "./app/org-structure-service";
