// templating-event-manager.ts
import type { App, MarkdownView, Plugin } from "obsidian";
import { TFile } from "obsidian";
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
import {
	showSchemaModal as realShowSchemaModal,
	showJsonModal as realShowJsonModal,
} from "@features/templating-params-editor";

// Workflows and type inference
import { runTemplateWorkflows } from "../domain/template-workflows";
import type { ParamsSchema } from "../domain/types";
import { getAgileArtifactType } from "@features/task-filter";
import type { AgileArtifactType } from "@features/task-filter";

type WorkflowAugmentedParams = Record<string, unknown> & {
	blockRef?: unknown;
	linkedArtifactType?: AgileArtifactType;
};

type TaskIndexResolvedTask = ReturnType<TaskIndexPort["getTaskByBlockRef"]>;

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

	function tryResolveTaskSync(blockRef: string): TaskIndexResolvedTask | undefined {
		const taskIndex = _ports?.taskIndex;
		if (!taskIndex?.getTaskByBlockRef) return undefined;

		// 1) Try exact
		let t = taskIndex.getTaskByBlockRef(blockRef ?? "") as TaskIndexResolvedTask;
		if (t) return t;

		// 2) Try "#^<id>" only (if we can parse a blockId)
		const { filePart, blockId } = parseBlockRef(blockRef);
		if (blockId) {
			const ref2 = `#^${blockId}`;
			t = taskIndex.getTaskByBlockRef(ref2) as TaskIndexResolvedTask;
			if (t) return t;
		}

		// 3) If filePart lacks ".md", try "<file>.md#^<id>"
		if (filePart && blockId && !/\.[a-zA-Z0-9]+$/.test(filePart)) {
			const augmented = `${ensureMdSuffix(filePart)}#^${blockId}`;
			t = taskIndex.getTaskByBlockRef(augmented) as TaskIndexResolvedTask;
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
						// Preserve full params schema so modals have type, label, placeholder, options, etc.
						paramsSchema: def.paramsSchema
							? {
									...def.paramsSchema,
									fields:
										def.paramsSchema.fields?.map((f) => ({
											...f,
										})) ?? [],
							  }
							: undefined,
				  }
				: undefined;
		},

		// Must be synchronous per ports typing
		prefillTemplateParams: (templateId, wrapperEl) => {
			// Get base params from the existing service (sync)
			const baseParams =
				realPrefillTemplateParams(templateId, wrapperEl);

			// If the template declares insertWorkflows, run them in background and cache
			const def = realFindTemplateById(templateId);

			if (def?.insertWorkflows && def.insertWorkflows.length) {
				void (async () => {
					try {
						const nextParams = await runTemplateWorkflows(
							def,
							(baseParams ?? {}) as Record<string, unknown>,
							{ taskIndex: _ports?.taskIndex }
						);
						workflowCache.set(templateId, nextParams);
					} catch {
						// swallow: rendering will just use base params
					}
				})();
			}

			return baseParams;
		},

		// Must remain synchronous per ports typing.
		// Merge cached workflow-derived params and, if needed, perform a synchronous, local inference
		// so we never miss linkedArtifactType due to timing or loosely formatted blockRef.
		renderTemplateOnly: (
			templateId: string,
			params?: Record<string, unknown>
		) => {
			const def = realFindTemplateById(templateId);

			const cached = workflowCache.get(templateId);
			if (cached) {
				workflowCache.delete(templateId);
			}

			let merged: WorkflowAugmentedParams;
			if (cached) {
				merged = {
					...(params ?? {}),
					...cached,
				} as WorkflowAugmentedParams;
			} else {
				merged = (params ?? {}) as WorkflowAugmentedParams;
			}

			if (
				def?.insertWorkflows?.includes(
					"resolveArtifactTypeFromBlockRef"
				)
			) {
				// NOTE: 'in' is used instead of Object.prototype.hasOwnProperty.call(...)
				// to avoid the Function.prototype.call -> any return type, which trips
				// @typescript-eslint/no-unsafe-assignment.
				const hasLinkedType = "linkedArtifactType" in merged;

				const source = merged.blockRef;
				const rawBlockRef =
					source === undefined || source === null
						? ""
						: String(source);
				const blockRef = rawBlockRef.trim();

				if (!hasLinkedType && blockRef) {
					try {
						const task = tryResolveTaskSync(blockRef);
						if (task) {
							const inferred =
								getAgileArtifactType(task) as
									| AgileArtifactType
									| undefined;
							if (inferred) {
								merged = {
									...merged,
									linkedArtifactType: inferred,
								} as WorkflowAugmentedParams;
							}
						}
					} catch {
						// ignore sync inference errors
					}
				}
			}

			return realRenderTemplateOnly(templateId, merged);
		},

		showSchemaModal: (
			templateId: string,
			schema: ParamsSchema,
			isEdit: boolean
		) => {
			const normalizedSchema: ParamsSchema = {
				...schema,
				fields:
					schema.fields?.map((f) => ({
						...f,
					})) ?? [],
			};

			return realShowSchemaModal(
				app,
				templateId,
				normalizedSchema,
				isEdit
			);
		},

		showJsonModal: (
			templateId: string,
			initialJson: string
		) => realShowJsonModal(app, templateId, initialJson),
	};

	// Vault adapter for file I/O (used by params-editor for wrapper replacement)
	const vault = {
		readFile: async (path: string): Promise<string> => {
			const af = app.vault.getAbstractFileByPath(path);
			if (!af) throw new Error(`File not found: ${path}`);
			if (!(af instanceof TFile)) {
				throw new Error(`Not a file: ${path}`);
			}
			return app.vault.read(af);
		},
		writeFile: async (path: string, content: string): Promise<void> => {
			const af = app.vault.getAbstractFileByPath(path);
			if (!af) throw new Error(`File not found: ${path}`);
			if (!(af instanceof TFile)) {
				throw new Error(`Not a file: ${path}`);
			}
			await app.vault.modify(af, content);
		},
	};

	// In the editor context, Obsidian will refresh the view automatically after vault.modify.
	const refresh = {
		refreshForFile: async (_filePath?: string | null) => {},
	};

	// Determine file path and line hint resolver for the current view
	const filePath = view.file?.path || "";
	const getLineHint0 = (): number | null => {
		try {
			const ln = view.editor?.getCursor?.().line;
			return typeof ln === "number" ? ln : null;
		} catch {
			return null;
		}
	};

	// Attach the editor click handler (capture=true to beat default behaviors)
	attachEditorTemplatingHandler({
		app,
		viewContainer: targetEl,
		registerDomEvent: (
			el: HTMLElement | Document | Window,
			type: string,
			handler: (evt: MouseEvent) => void,
			options?: boolean | AddEventListenerOptions
		) => {
			// Bridge to Obsidian's overloaded registerDomEvent without using `any`.
			// All overloads expect a callback with `this: HTMLElement`, so we cast
			// the handler accordingly and, in the HTMLElement case, explicitly
			// narrow `el` to HTMLElement to avoid union overload ambiguity.
			if (el === window) {
				plugin.registerDomEvent(
					window,
					type as keyof WindowEventMap,
					handler as (this: HTMLElement, ev: MouseEvent) => unknown,
					options
				);
			} else if (el instanceof Document) {
				plugin.registerDomEvent(
					el,
					type as keyof DocumentEventMap,
					handler as (this: HTMLElement, ev: MouseEvent) => unknown,
					options
				);
			} else {
				plugin.registerDomEvent(
					el as HTMLElement,
					type as keyof HTMLElementEventMap,
					handler as (this: HTMLElement, ev: MouseEvent) => unknown,
					options
				);
			}
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