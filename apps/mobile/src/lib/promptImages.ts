import {
	MAX_PROMPT_IMAGE_BYTES,
	MAX_PROMPT_IMAGES,
	MAX_PROMPT_TOTAL_IMAGE_BYTES,
	type PromptImage,
} from "@pimate/protocol";
import { base64Bytes } from "./entryImages";

export function promptImageLimit(view: { promptImages?: boolean; promptImageLimit?: number } | null): number {
	if (view?.promptImages !== true) return 0;
	return Number.isSafeInteger(view.promptImageLimit) && view.promptImageLimit! > 0
		? Math.min(MAX_PROMPT_IMAGES, view.promptImageLimit!)
		: 1;
}

/** Share only the remaining decoded budget among new photos; existing attachments remain byte-identical. */
export function newImageBudget(existing: readonly PromptImage[], count: number): number {
	const remaining = MAX_PROMPT_TOTAL_IMAGE_BYTES - existing.reduce((sum, image) => sum + base64Bytes(image.data), 0);
	return count > 0 ? Math.max(0, Math.min(MAX_PROMPT_IMAGE_BYTES, Math.floor(remaining / count))) : 0;
}
