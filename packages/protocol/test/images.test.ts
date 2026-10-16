import { describe, expect, it } from "vitest";
import { MAX_PROMPT_IMAGE_BYTES, samePromptImages, validPromptImages } from "../src/images.ts";

const image = { type: "image", mimeType: "image/jpeg", data: "YQ==" } as const;
describe("prompt images", () => {
	it("accepts one supported image or no images, and compares complete content", () => {
		for (const mimeType of ["image/jpeg", "image/png", "image/webp"])
			expect(validPromptImages([{ ...image, mimeType }])).toBe(true);
		expect(validPromptImages([])).toBe(true);
		expect(samePromptImages(undefined, [])).toBe(true);
		expect(samePromptImages([image], [{ ...image }])).toBe(true);
		expect(samePromptImages([image], [{ ...image, data: "Yg==" }])).toBe(false);
	});
	it.each([
		null,
		{},
		[null],
		[image, image],
		[{ ...image, type: "text" }],
		[{ ...image, mimeType: "image/gif" }],
		...["", "a", "YWJ", "YQ=", "Y===", "====", "Y Q==", "YQ==\n", "data:image/jpeg;base64,YQ==", "YQ-="].map((data) => [
			{ ...image, data },
		]),
	])("rejects invalid images %j", (value) => {
		expect(validPromptImages(value)).toBe(false);
	});
	it("bounds decoded bytes, including padding at the exact limit", () => {
		const encoded = (bytes: number) => [{ ...image, data: Buffer.alloc(bytes).toString("base64") }];
		expect(validPromptImages(encoded(MAX_PROMPT_IMAGE_BYTES))).toBe(true);
		expect(validPromptImages(encoded(MAX_PROMPT_IMAGE_BYTES + 1))).toBe(false);
	});
});
