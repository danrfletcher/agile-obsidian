export type { Sequence, SequenceDirection } from "./domain/types";
export { buildSequences } from "./domain/preset-sequences";

export {
	buildSequenceIndex,
	getSequences,
	getSequenceIndex,
	computeAvailableMoves,
	executeSequenceMove,
	executeSequenceMoveOnFile,
} from "./app/sequencer-service";

export { openSequencerMenuAt } from "./ui/menu";
export { wireTemplatingSequencerDomHandlers } from "./ui/handlers";

// New: generalized custom view handler for future reuse
export { attachCustomViewTemplatingSequencerHandler } from "./ui/custom-view-handler";
