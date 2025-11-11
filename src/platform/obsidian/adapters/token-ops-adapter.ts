import {
	appendEmojiWithDate,
	CANCELLED_EMOJI,
	COMPLETED_EMOJI,
	hasEmoji,
	ISO_DATE_RE,
	removeEmoji,
} from "@features/task-close-manager";

/**
 * Adapter for token/emoji operations from task-close-manager.
 * Structurally compatible with TokenOpsPort (feature-side interface).
 * Lives in platform to keep feature code platform-agnostic.
 */
export class TokenOps {
	COMPLETED_EMOJI = COMPLETED_EMOJI;
	CANCELLED_EMOJI = CANCELLED_EMOJI;
	ISO_DATE_RE = ISO_DATE_RE;
	hasEmoji(text: string, emoji: string): boolean {
		return hasEmoji(text, emoji);
	}
	appendEmojiWithDate(text: string, emoji: string, date?: string): string {
		return appendEmojiWithDate(text, emoji, date);
	}
	removeEmoji(text: string, emoji: string): string {
		return removeEmoji(text, emoji);
	}
}
