import {
	renderTemplateOnly,
	findTemplateById,
} from "./templating-service";
import { runTemplateWorkflows } from "../domain/template-workflows";
import type { LinkArtifactApp } from "../domain/link-artifact-resolver";

/**
 * Render a template's HTML after awaiting its insertWorkflows against exactly the
 * params given (e.g. Link to Artifact reads its target on demand and resolves the
 * linked type from the blockRef being rendered).
 *
 * Nothing is cached between calls, so concurrent renders never share workflow
 * results. A workflow that can't resolve (missing/unreadable target) just leaves the
 * params without the derived value: this never rejects because of a lookup.
 */
export async function renderTemplateWithWorkflows(
	app: LinkArtifactApp,
	templateId: string,
	params: Record<string, unknown> | undefined,
	sourcePath: string
): Promise<string> {
	const def = findTemplateById(templateId);
	let resolved: Record<string, unknown> = params ?? {};
	if (def?.insertWorkflows?.length) {
		try {
			resolved = await runTemplateWorkflows(def, resolved, {
				app,
				sourcePath,
			});
		} catch {
			// Keep the params as given: the chip is written without a type.
		}
	}
	return renderTemplateOnly(templateId, resolved);
}
