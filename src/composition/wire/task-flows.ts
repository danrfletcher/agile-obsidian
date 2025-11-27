import type { Container } from "../container";
import { wireTaskAssignmentCascade } from "@features/task-assignment-cascade";
import {
	wireTaskClosedCascade,
	wireTaskClosedCascadeObserver,
} from "@features/task-close-cascade";
import { registerTaskMetadataCleanup } from "@features/task-metadata-cleanup";
import { wireTaskCloseManager } from "@features/task-close-manager";
import { wireTaskStatusSequence } from "@features/task-status-sequencer";

/**
 * Wires cross-cutting task flows and cleanup behaviors.
 */
export function wireTaskFlows(container: Container): void {
	const { app, plugin, taskIndexService } = container;

	try {
		if (taskIndexService) {
			wireTaskAssignmentCascade(app, plugin, {
				taskIndex: taskIndexService,
			});
		}
	} catch (e) {
		globalThis.console?.error?.(
			"[boot] assignment cascade wiring failed",
			e
		);
	}

	try {
		// 1) Status sequence first to override defaults
		wireTaskStatusSequence(app, plugin);
		// 2) Close manager reacts to transitions
		wireTaskCloseManager(app, plugin);
		// 3) Cascade: event-driven and passive observer
		wireTaskClosedCascade(app, plugin);
		wireTaskClosedCascadeObserver(app, plugin);
	} catch (e) {
		globalThis.console?.error?.(
			"[boot] closed cascade wiring failed",
			e
		);
	}

	try {
		registerTaskMetadataCleanup(container);
	} catch (e) {
		globalThis.console?.error?.(
			"[boot] task-metadata-cleanup wiring failed",
			e
		);
	}
}