import type { PromptImage, ViewImage } from "@pimate/protocol";
import { describe, expect, it, vi } from "vitest";
import { EntryImageCache, entryImageSources, imageSlots, imageTiles, validViewImage } from "../src/lib/entryImages";

const image: PromptImage = { type: "image", mimeType: "image/png", data: "YQ==" };
const other: ViewImage = { mimeType: "image/gif", data: "Yg==" };

describe("entry image memory cache", () => {
	it("shares in-flight loads, caches results and serializes distinct network requests", async () => {
		const cache = new EntryImageCache();
		let resolve!: (image: ViewImage) => void;
		const fetch = vi.fn(
			() =>
				new Promise<ViewImage>((done) => {
					resolve = done;
				}),
		);
		const secondFetch = vi.fn(async () => other);
		const first = cache.load("entry:0", fetch);
		expect(cache.load("entry:0", fetch)).toBe(first);
		const second = cache.load("entry:1", secondFetch);
		await Promise.resolve();
		expect(fetch).toHaveBeenCalledOnce();
		expect(secondFetch).not.toHaveBeenCalled();
		resolve(image);
		expect(await first).toBe(image);
		expect(await second).toBe(other);
		expect(await cache.load("entry:0", fetch)).toBe(image);
		expect(fetch).toHaveBeenCalledOnce();
	});
	it("evicts least-recently-used items using UTF-16 base64 bytes, not decoded size", async () => {
		const cache = new EntryImageCache(16); // Two four-character strings at two bytes per character.
		const fetch = vi.fn(async () => image);
		await cache.load("a", fetch);
		await cache.load("b", fetch);
		await cache.load("a", fetch);
		await cache.load("c", fetch);
		await cache.load("a", fetch);
		expect(fetch).toHaveBeenCalledTimes(3);
		await cache.load("b", fetch);
		expect(fetch).toHaveBeenCalledTimes(4);
	});
	it("does not retain oversized results or failed requests, and failures do not block the queue", async () => {
		const cache = new EntryImageCache(4);
		const fetch = vi.fn(async () => image);
		await cache.load("large", fetch);
		await cache.load("large", fetch);
		expect(fetch).toHaveBeenCalledTimes(2);
		await expect(
			cache.load("bad", () => {
				throw new Error("offline");
			}),
		).rejects.toThrow("offline");
		expect(await cache.load("bad", fetch)).toBe(image);
	});
});

describe("image preview slots and tiles", () => {
	it("uses original indices for sparse previews and supports old positional previews", () => {
		expect(imageSlots({ images: [image], imageIndices: [2], imageCount: 4 })).toEqual([
			undefined,
			undefined,
			image,
			undefined,
		]);
		expect(imageSlots({ images: [image], imageCount: 2 })).toEqual([image, undefined]);
		expect(imageSlots({ images: [image] })).toEqual([image]);
		expect(imageSlots({ imageCount: 2 })).toEqual([undefined, undefined]);
		expect(imageSlots({ images: [image], imageIndices: [-1], imageCount: 1 })).toEqual([undefined]);
	});
	it("shows at most four tiles and includes the first hidden image in +N", () => {
		expect(imageTiles(0)).toEqual([]);
		expect(imageTiles(4)).toEqual([{ index: 0 }, { index: 1 }, { index: 2 }, { index: 3 }]);
		expect(imageTiles(7)).toEqual([{ index: 0 }, { index: 1 }, { index: 2 }, { index: 3, more: 4 }]);
	});
	it("accepts GIF and large view-only images, rejects malformed or oversized payloads", () => {
		expect(validViewImage(other)).toBe(true);
		expect(validViewImage({ ...other, data: Buffer.alloc(5 * 1024 * 1024).toString("base64") })).toBe(true);
		for (const value of [
			null,
			{},
			{ ...other, mimeType: "image/svg+xml" },
			...["", "x", "YQ=", "Y Q==", "YQ==\n"].map((data) => ({ ...other, data })),
			{ ...other, data: Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64") },
		])
			expect(validViewImage(value)).toBe(false);
	});
});

it("uses thumbnail-only tile loaders while the viewer independently loads full images", async () => {
	const load = vi.fn(async () => other);
	const { gallery, thumbnails } = entryImageSources({ imageCount: 2, images: [image], imageIndices: [1] }, load);
	expect(load).not.toHaveBeenCalled();
	if (!("load" in thumbnails[0]!) || !("load" in gallery[0]!)) throw new Error("Missing loaders");
	await thumbnails[0].load();
	expect(load.mock.calls).toEqual([[0, true]]);
	await gallery[0].load();
	expect(load.mock.calls).toEqual([
		[0, true],
		[0, false],
	]);
	expect(thumbnails[1]).toBe(image);
	expect(gallery[1]).toBe(image);
	expect(entryImageSources({ images: [image], imageCount: 2 })).toEqual({ gallery: [image], thumbnails: [image] });
});
