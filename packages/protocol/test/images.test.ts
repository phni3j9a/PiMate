import { describe, expect, it } from "vitest";
import {
	MAX_IMAGE_PROMPT_TEXT,
	MAX_PROMPT_IMAGE_BYTES,
	MAX_PROMPT_IMAGES,
	MAX_PROMPT_TOTAL_IMAGE_BYTES,
	samePromptImages,
	validPromptImages,
} from "../src/images.ts";

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
		Array(MAX_PROMPT_IMAGES + 1).fill(image),
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

it("accepts four images within the total budget and bounds worst-case escaped JSON under 1 MiB", () => {
	const images = [
		{ ...image, data: Buffer.alloc(MAX_PROMPT_IMAGE_BYTES).toString("base64") },
		{ ...image, data: Buffer.alloc(MAX_PROMPT_TOTAL_IMAGE_BYTES - MAX_PROMPT_IMAGE_BYTES - 2).toString("base64") },
		image,
		image,
	];
	expect(validPromptImages(images)).toBe(true);
	expect(validPromptImages([...images.slice(0, 3), { ...image, data: "YWE=" }])).toBe(false);
	const request = {
		id: "image",
		type: "rc",
		instanceId: "i",
		request: { id: "image", method: "prompt", params: { text: "\u0000".repeat(MAX_IMAGE_PROMPT_TEXT), images } },
	};
	expect(Buffer.byteLength(JSON.stringify(request))).toBeLessThan(1024 * 1024);
});
