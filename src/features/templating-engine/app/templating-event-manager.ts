// templating-event-manager.ts
import type { App, MarkdownView, Plugin } from "obsidian";
import type { TaskIndexPort } from "./templating-ports";

import {
	attachEditorTemplatingHandler,
	type TemplatingPorts,
} from "@features/templating-params-editor";

import {
	prefillTemplateParams as realPrefillTemplateParams,
	renderTemplateOnly as realRenderTemplateOnly,
	findTemplateById as realFindTemplateById,
} from "./templating-service";
import { showSchemaModal as realShowSchemaModal } from "@features/templating-params-editor";
import { showJsonModal as realShowJsonModal } from "@features/templating-params-editor";

// Workflows and type inference
import { runTemplateWorkflows } from "../domain/template-workflows";
import { getAgileArtifactType } from "@features/task-filter";

/**
 * Wire editor DOM handlers for templating, including slash-command insertion modal.
 * Ports must remain synchronous. We run workflows in background during prefill and cache the result.
 * Additionally, we perform a synchronous, local inference in renderTemplateOnly to avoid races
 * and to normalize blockRef formats for TaskIndex lookups.
 */
export function wireTemplatingDomHandlers(
	app: App,
	view: MarkdownView,
	plugin: Plugin,
	_ports: { taskIndex: TaskIndexPort }
) {
	// Resolve content root
	const cmHolder = view as unknown as {
		editor?: { cm?: { contentDOM?: HTMLElement } };
	};
	const cmContent = cmHolder.editor?.cm?.contentDOM;
	const contentRoot = (cmContent ??
		view.containerEl.querySelector(".cm-content")) as HTMLElement | null;
	const targetEl: HTMLElement = contentRoot ?? view.containerEl;

	// Cache to pass async workflow results into the sync renderer
	const workflowCache = new Map<string, Record<string, unknown>>();

	// Small helpers to normalize and resolve a blockRef against TaskIndex synchronously
	function parseBlockRef(raw: string): { filePart: string; blockId: string } {
		const s = String(raw || "").trim();
		const marker = "#^";
		const idx = s.indexOf(marker);
		if (idx === -1) return { filePart: s, blockId: "" };
		const filePart = s.slice(0, idx);
		const blockId = s.slice(idx + marker.length).trim();
		return { filePart, blockId };
	}

	function ensureMdSuffix(path: string): string {
		const p = String(path || "").trim();
		if (!p) return p;
		if (/\.[a-zA-Z0-9]+$/.test(p)) return p;
		return `${p}.md`;
	}

	function tryResolveTaskSync(blockRef: string) {
		// 1) Try exact
		let t =
			_ports?.taskIndex?.getTaskByBlockRef?.(blockRef ?? "") ?? undefined;
		if (t) return t;

		// 2) Try "#^<id>" only (if we can parse a blockId)
		const { filePart, blockId } = parseBlockRef(blockRef);
		if (blockId) {
			const ref2 = `#^${blockId}`;
			t = _ports?.taskIndex?.getTaskByBlockRef?.(ref2) ?? undefined;
			if (t) return t;
		}

		// 3) If filePart lacks ".md", try "<file>.md#^<id>"
		if (filePart && blockId && !/\.[a-zA-Z0-9]+$/.test(filePart)) {
			const augmented = `${ensureMdSuffix(filePart)}#^${blockId}`;
			t = _ports?.taskIndex?.getTaskByBlockRef?.(augmented) ?? undefined;
			if (t) return t;
		}

		return undefined;
	}

	const templating: TemplatingPorts = {
		findTemplateById: (id) => {
			const def = realFindTemplateById(id);
			return def
				? {
						id: def.id,
						hasParams: !!def.hasParams,
						hiddenFromDynamicCommands:
							def.hiddenFromDynamicCommands,
						paramsSchema: def.paramsSchema
							? {
									...def.paramsSchema,
									fields:
										def.paramsSchema.fields?.map((f) => ({
											name: f.name,
											required: f.required,
											defaultValue:
												typeof f.defaultValue ===
												"string"
													? f.defaultValue
													: (f.defaultValue as unknown as
															| string
															| undefined),
										})) ?? [],
							  }
							: undefined,
				  }
				: undefined;
		},

		// Must be synchronous per ports typing
		prefillTemplateParams: (templateId, wrapperEl) => {
			// Get base params from the existing service (sync)
			const baseParams = realPrefillTemplateParams(templateId, wrapperEl);

			// If the template declares insertWorkflows, run them in background and cache
			const def = realFindTemplateById(templateId) as
				| { id: string; insertWorkflows?: string[] }
				| undefined;

			if (def?.insertWorkflows && def.insertWorkflows.length) {
				void (async () => {
					try {
						const nextParams = await runTemplateWorkflows(
							def as any,
							(baseParams ?? {}) as Record<string, unknown>,
							{ taskIndex: _ports?.taskIndex }
						);
						workflowCache.set(templateId, nextParams);
					} catch {
						// swallow: rendering will just use base params
					}
				})();
			}

			return baseParams as any;
		},

		// Must remain synchronous per ports typing.
		// Merge cached workflow-derived params and, if needed, perform a synchronous, local inference
		// so we never miss linkedArtifactType due to timing or loosely formatted blockRef.
		renderTemplateOnly: (
			templateId: string,
			params?: Record<string, unknown>
		) => {
			const def = realFindTemplateById(templateId) as
				| { id: string; insertWorkflows?: string[] }
				| undefined;

			const cached = workflowCache.get(templateId);
			if (cached) {
				workflowCache.delete(templateId);
			}

			// Workflow-derived values take precedence over base params if overlapping.
			let merged = cached
				? { ...(params ?? {}), ...cached }
				: params ?? {};

			// If this template declares the artifact-type inference workflow and the value is still missing,
			// do a synchronous best-effort inference using TaskIndex (no Vault fallback).
			if (
				def?.insertWorkflows?.includes(
					"resolveArtifactTypeFromBlockRef"
				)
			) {
				const hasLinkedType =
					merged &&
					Object.prototype.hasOwnProperty.call(
						merged,
						"linkedArtifactType"
					);
				const blockRef = String((merged as any)?.blockRef ?? "").trim();

				if (!hasLinkedType && blockRef) {
					try {
						const task = tryResolveTaskSync(blockRef);
						if (task) {
							const inferred = getAgileArtifactType(task);
							if (inferred) {
								merged = {
									...merged,
									linkedArtifactType: inferred,
								};
							}
						}
					} catch {
						// ignore sync inference errors
					}
				}
			}

			return realRenderTemplateOnly(templateId, merged);
		},

		showSchemaModal: (templateId, schema, isEdit) => {
			// Keep signature synchronous for the editor port; cast Promise as any
			return realShowSchemaModal(
				app,
				templateId,
				{
					...schema,
					fields:
						schema.fields?.map((f) => ({
							...f,
						})) ?? [],
				} as any,
				isEdit
			) as any;
		},

		showJsonModal: (templateId, initialJson) =>
			realShowJsonModal(app, templateId, initialJson) as any,
	};

	// Vault adapter for file I/O (used by params-editor for wrapper replacement)
	const vault = {
		readFile: async (path: string) => {
			const af = (app.vault as any).getAbstractFileByPath(path);
			if (!af) throw new Error(`File not found: ${path}`);
			return (app.vault as any).read(af);
		},
		writeFile: async (path: string, content: string) => {
			const af = (app.vault as any).getAbstractFileByPath(path);
			if (!af) throw new Error(`File not found: ${path}`);
			await (app.vault as any).modify(af, content);
		},
	};

	// In the editor context, Obsidian will refresh the view automatically after vault.modify.
	const refresh = {
		refreshForFile: async (_filePath?: string | null) => {},
	};

	// Determine file path and line hint resolver for the current view
	const filePath = view.file?.path || "";
	const getLineHint0 = () => {
		try {
			const ln = (view as any)?.editor?.getCursor?.()?.line;
			return typeof ln === "number" ? ln : null;
		} catch {
			return null;
		}
	};

	// Attach the editor click handler (capture=true to beat default behaviors)
	attachEditorTemplatingHandler({
		app,
		viewContainer: targetEl,
		registerDomEvent: (el, type, handler, options) => {
			(plugin.registerDomEvent as any)(
				el as any,
				type as any,
				handler as any,
				options as any
			);
		},
		deps: {
			templating,
			vault,
			refresh,
		},
		filePath,
		getLineHint0,
		useObsidianNotice: true,
	});
}
