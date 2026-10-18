import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { resizeImage } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	fileImage,
	imageMimeType,
	MAX_FILE_IMAGE_BYTES,
	MAX_THUMBNAIL_IMAGE_BYTES,
	MAX_VIEW_IMAGE_BYTES,
	MAX_VIEW_IMAGE_FALLBACK_BYTES,
	resolveImagePath,
	viewImage,
} from "../src/extension/images.ts";

vi.mock("@earendil-works/pi-coding-agent", () => ({ resizeImage: vi.fn() }));
afterEach(() => vi.resetAllMocks());

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
describe("image files", () => {
	it.each([
		[png, "image/png"],
		[Buffer.from([255, 216, 255, 224]), "image/jpeg"],
		[Buffer.from("RIFF0000WEBPVP8 "), "image/webp"],
		[Buffer.from("GIF87a"), "image/gif"],
		[Buffer.from("GIF89a"), "image/gif"],
		[Buffer.from("<svg/>"), undefined],
		[Buffer.from("RIFF0000WAVE"), undefined],
		[Buffer.from("GIF89"), undefined],
		[png.subarray(0, 7), undefined],
		[Buffer.alloc(0), undefined],
	])("detects format by bytes: %j", (bytes, mimeType) => {
		expect(imageMimeType(bytes)).toBe(mimeType);
	});
	it("resolves session-relative, absolute, home and file URL paths", () => {
		expect(resolveImagePath("../image.png", "/session/sub")).toBe("/session/image.png");
		expect(resolveImagePath("/elsewhere/image.png", "/session")).toBe("/elsewhere/image.png");
		expect(resolveImagePath("~/image.png", "/session")).toBe(join(homedir(), "image.png"));
		expect(resolveImagePath("file:///tmp/an%20image.png", "/session")).toBe("/tmp/an image.png");
		expect(() => resolveImagePath("file://remote/image.png", "/session")).toThrow("Invalid image path");
		expect(() => resolveImagePath("file:///tmp/%ZZ", "/session")).toThrow("Invalid image path");
	});
	it("reads only bounded regular files, ignores extensions, and maps errors", async () => {
		const dir = await mkdtemp(join(tmpdir(), "pimate-images-"));
		try {
			const file = join(dir, "an image.txt");
			await writeFile(file, png);
			const expected = { mimeType: "image/png", data: png.toString("base64") };
			for (const path of ["an image.txt", file, pathToFileURL(file).href])
				expect(await fileImage(path, dir)).toEqual(expected);
			await expect(fileImage("missing.png", dir)).rejects.toMatchObject({ code: "not_found" });
			await expect(fileImage(dir, dir)).rejects.toMatchObject({ code: "unsupported" });
			await writeFile(file, "not an image");
			await expect(fileImage(file, dir)).rejects.toMatchObject({ code: "unsupported" });
			await truncate(file, MAX_FILE_IMAGE_BYTES + 1);
			await expect(fileImage(file, dir)).rejects.toMatchObject({ code: "unsupported" });
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("view images", () => {
	it("returns originals up to 2 MiB without decoding/resizing, including GIF", async () => {
		const bytes = Buffer.alloc(MAX_VIEW_IMAGE_BYTES);
		expect(await viewImage(bytes, "image/gif")).toEqual({ mimeType: "image/gif", data: bytes.toString("base64") });
		expect(resizeImage).not.toHaveBeenCalled();
		await expect(viewImage(png, "image/svg+xml")).rejects.toMatchObject({ code: "unsupported" });
	});
	it("resizes larger images with Pi's encoded-byte limit and dimensions", async () => {
		vi.mocked(resizeImage).mockResolvedValue({
			data: "YQ==",
			mimeType: "image/jpeg",
			width: 2048,
			height: 1024,
			originalWidth: 4096,
			originalHeight: 2048,
			wasResized: true,
		});
		const bytes = Buffer.alloc(MAX_VIEW_IMAGE_BYTES + 1);
		expect(await viewImage(bytes, "image/png")).toEqual({
			mimeType: "image/jpeg",
			data: "YQ==",
			width: 2048,
			height: 1024,
		});
		expect(vi.mocked(resizeImage).mock.calls[0]?.[0]).toBe(bytes);
		expect(vi.mocked(resizeImage).mock.calls[0]?.slice(1)).toEqual([
			"image/png",
			{
				maxWidth: 2048,
				maxHeight: 2048,
				maxBytes: Math.floor(MAX_VIEW_IMAGE_BYTES / 3) * 4,
			},
		]);
	});
	it.each(["throws", "null", "oversized", "undefined"])(
		"falls back within the absolute cap when resize %s",
		async (mode) => {
			if (mode === "throws") vi.mocked(resizeImage).mockRejectedValue(new Error("unavailable"));
			if (mode === "null") vi.mocked(resizeImage).mockResolvedValue(null);
			if (mode === "oversized")
				vi.mocked(resizeImage).mockResolvedValue({
					data: Buffer.alloc(MAX_VIEW_IMAGE_BYTES + 1).toString("base64"),
					mimeType: "image/png",
				} as never);
			// The default undefined result also covers an older runtime with no usable resizer.
			const bytes = Buffer.alloc(MAX_VIEW_IMAGE_FALLBACK_BYTES);
			expect(await viewImage(bytes, "image/webp")).toMatchObject({ data: bytes.toString("base64") });
			await expect(viewImage(Buffer.alloc(MAX_VIEW_IMAGE_FALLBACK_BYTES + 1), "image/webp")).rejects.toMatchObject({
				code: "unsupported",
			});
		},
	);
});

describe("entry thumbnails", () => {
	it.each([1024, 3 * 1024 * 1024])("always invokes Pi resize for a %i-byte source", async (size) => {
		vi.mocked(resizeImage).mockResolvedValue({
			data: "YQ==",
			mimeType: "image/jpeg",
			width: 320,
			height: 160,
			originalWidth: 2048,
			originalHeight: 1024,
			wasResized: true,
		});
		expect(await viewImage(Buffer.alloc(size), "image/png", true)).toEqual({
			mimeType: "image/jpeg",
			data: "YQ==",
			width: 320,
			height: 160,
		});
		expect(vi.mocked(resizeImage).mock.calls[0]?.slice(1)).toEqual([
			"image/png",
			{ maxWidth: 320, maxHeight: 320, jpegQuality: 60, maxBytes: Math.floor(MAX_THUMBNAIL_IMAGE_BYTES / 3) * 4 },
		]);
	});
	it.each(["throws", "null", "oversized"])("caps thumbnail fallback at 512 KiB when resize %s", async (mode) => {
		if (mode === "throws") vi.mocked(resizeImage).mockRejectedValue(new Error("unavailable"));
		if (mode === "null") vi.mocked(resizeImage).mockResolvedValue(null);
		if (mode === "oversized")
			vi.mocked(resizeImage).mockResolvedValue({
				data: Buffer.alloc(MAX_THUMBNAIL_IMAGE_BYTES + 1).toString("base64"),
				mimeType: "image/png",
			} as never);
		const bytes = Buffer.alloc(512 * 1024);
		expect((await viewImage(bytes, "image/png", true)).data).toBe(bytes.toString("base64"));
		await expect(viewImage(Buffer.alloc(512 * 1024 + 1), "image/png", true)).rejects.toMatchObject({
			code: "unsupported",
		});
	});
});
