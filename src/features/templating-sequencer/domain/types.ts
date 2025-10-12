/**
 * Templating Sequencer - Domain Types
 *
 * Defines the core "Sequence" schema and generics for type-safe variable mapping
 * between templates. This schema is intentionally minimal and extensible.
 */

export type SequenceDirection = "forwards" | "both";

/**
 * A typed mapping function that transforms parameter values from a start template
 * to a target template. Return a partial; additional properties can be collected via modal.
 */
export type ForwardMapper<TStartParams, TTargetParams> = (args: {
	start: Readonly<TStartParams>;
}) => Partial<TTargetParams> | Promise<Partial<TTargetParams>>;

/**
 * Optional reverse mapping for "both" direction sequences, transforming from target -> start.
 */
export type BackwardMapper<TStartParams, TTargetParams> = (args: {
	target: Readonly<TTargetParams>;
}) => Partial<TStartParams> | Promise<Partial<TStartParams>>;

/**
 * A Sequence models a permissible move between two templates and how to map values.
 * - startTemplate: source template key (e.g., "crm.depositPaid")
 * - targetTemplate: destination template key (e.g., "crm.paidInFull")
 * - direction: "forwards" or "both" (allow reverse option when "both")
 * - variableMap: mapping callbacks (forward required, backward optional)
 * - label: optional display name to show in menus; we also show the target template's label from its definition.
 * - isAvailable?: optional predicate to dynamically hide/show a movement based on current values.
 */
export interface Sequence<TStartParams = any, TTargetParams = any> {
	id: string;
	startTemplate: string;
	targetTemplate: string;
	direction: SequenceDirection;
	variableMap: {
		forward: ForwardMapper<TStartParams, TTargetParams>;
		backward?: BackwardMapper<TStartParams, TTargetParams>;
	};
	label?: string;
	isAvailable?: (args: {
		startTemplate: string;
		targetTemplate: string;
		// Current values on the clicked template (best-effort string map)
		currentParams: Record<string, unknown>;
		// Movement direction we plan to execute
		direction: "forward" | "backward";
	}) => boolean;
}

/**
 * Light-weight index for fast lookups at runtime.
 */
export type SequenceIndex = {
	// Forward options keyed by startTemplate
	byStart: Map<string, Array<Sequence<any, any>>>;
	// Reverse-capable options keyed by targetTemplate (only sequences with direction="both")
	reversibleByTarget: Map<string, Array<Sequence<any, any>>>;
};
