export { createObsidianAppAdapter } from "./app/app-adapter";
export { getCursorContext } from "./editor/obsidian-editor-context";
export * from "./fs/fs-utils";
export * from "./editor/editor-context-utils";
export { createPathFileRepository } from "./fs/file-repository";

// New generic editor/vault primitives
export * from "./editor/scroll-preserver";
export * from "./editor/editor-mutations";
export * from "./editor/editor-interaction";
export * from "./vault/vault-mutations";

// Adapters for feature ports (structurally compatible; reusable across features)
export * from "./adapters/port-adapters";
export * from "./adapters/token-ops-adapter"
export { ObsidianLineClassifier } from "./adapters/line-classifier-adapter";
