import { MAX_PROMPT_IMAGE_BYTES } from "@pimate/protocol";
import { describe, expect, it, vi } from "vitest";
import { classifyImageSource, markdownImageGallery } from "../src/lib/markdownImages";
import { markdownImages, parseBlocks } from "../src/lib/richText";

describe("Markdown image sources", () => {
	it.each(["https://example.com/x.png?a=1", "http://localhost:3000/image", "HTTPS://example.com/x.webp"])(
		"loads %s directly",
		(src) => {
			expect(classifyImageSource(src)).toBe("remote");
		},
	);
	it.each([
		"/tmp/x.png",
		"./x.png",
		"../x.png",
		"x.png",
		"~/x.png",
		"file:///tmp/a%20b.png",
		"images/no-extension",
		"/tmp/日本語.png",
		"./100%real.png",
	])("loads PC path %s through the RC", (src) => {
		expect(classifyImageSource(src)).toBe("file");
	});
	it.each([
		"",
		"javascript:alert(1)",
		"content://image",
		"ftp://example.com/a.png",
		"//example.com/x.png",
		"data:image/svg+xml;base64,YQ==",
		"data:text/plain;base64,YQ==",
		"data:image/png;base64,Y Q==",
		"data:image/png;base64,YQ=",
		"data:image/png;base64,",
		"https://",
		"https://user:secret@example.com/a",
		"file://remote/a.png",
		"file:///tmp/a%ZZ.png",
		"file:///tmp/a.png?q=1",
		"a\0.png",
		"https://example.com/a.SVG?q=1",
		"https://example.com/a%2Esvg#x",
		"./x.svg",
		"~/x.svgz",
	])("leaves unsafe/unsupported source %s as text", (src) => {
		expect(classifyImageSource(src)).toBeNull();
	});
	it("accepts only bounded raster base64 data", () => {
		for (const mime of ["png", "jpeg", "webp", "gif"])
			expect(classifyImageSource(`data:image/${mime};base64,YQ==`)).toBe("data");
		expect(
			classifyImageSource(`data:image/png;base64,${Buffer.alloc(MAX_PROMPT_IMAGE_BYTES).toString("base64")}`),
		).toBe("data");
		expect(
			classifyImageSource(`data:image/png;base64,${Buffer.alloc(MAX_PROMPT_IMAGE_BYTES + 1).toString("base64")}`),
		).toBeNull();
	});
});

it("keeps every image in order, with independent lazy full-file requests and direct remote/data URIs", async () => {
	const blocks = parseBlocks(
		"![remote](https://x.dev/a.png) ![file](./b.png) ![data](data:image/gif;base64,YQ==)",
		true,
	);
	const load = vi.fn(async () => ({ mimeType: "image/png" as const, data: "YQ==" }));
	const gallery = markdownImageGallery(markdownImages(blocks), load);
	expect(load).not.toHaveBeenCalled();
	expect(gallery[0]).toEqual({ uri: "https://x.dev/a.png" });
	expect(gallery[2]).toEqual({ uri: "data:image/gif;base64,YQ==" });
	if (!("load" in gallery[1]!)) throw new Error("Missing file loader");
	await gallery[1].load();
	expect(load.mock.calls).toEqual([["./b.png", false]]);
});
