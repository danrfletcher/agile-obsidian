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
