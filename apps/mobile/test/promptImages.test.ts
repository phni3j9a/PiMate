import { MAX_PROMPT_IMAGE_BYTES, MAX_PROMPT_TOTAL_IMAGE_BYTES, type PromptImage } from "@pimate/protocol";
import { expect, it } from "vitest";
import { newImageBudget, promptImageLimit } from "../src/lib/promptImages";

it("requires explicit image capability and defaults old RCs to one photo", () => {
	expect(promptImageLimit(null)).toBe(0);
	expect(promptImageLimit({})).toBe(0);
	expect(promptImageLimit({ promptImages: true })).toBe(1);
	for (const promptImageLimitValue of [NaN, Infinity, -1, 0, 1.5])
		expect(promptImageLimit({ promptImages: true, promptImageLimit: promptImageLimitValue })).toBe(1);
	expect(promptImageLimit({ promptImages: true, promptImageLimit: 2 })).toBe(2);
	expect(promptImageLimit({ promptImages: true, promptImageLimit: 99 })).toBe(4);
});

it("divides only the remaining decoded budget between new images and respects per-image limits", () => {
	const image: PromptImage = {
		type: "image",
		mimeType: "image/jpeg",
		data: Buffer.alloc(MAX_PROMPT_IMAGE_BYTES).toString("base64"),
	};
	expect(newImageBudget([], 1)).toBe(MAX_PROMPT_IMAGE_BYTES);
	expect(newImageBudget([], 4)).toBe(MAX_PROMPT_TOTAL_IMAGE_BYTES / 4);
	expect(newImageBudget([image], 3)).toBe(Math.floor((MAX_PROMPT_TOTAL_IMAGE_BYTES - MAX_PROMPT_IMAGE_BYTES) / 3));
	expect(newImageBudget([image, image], 1)).toBe(0);
	expect(newImageBudget([], 0)).toBe(0);
});
