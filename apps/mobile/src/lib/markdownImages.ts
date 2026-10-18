import { MAX_PROMPT_IMAGE_BYTES, type ViewImage } from "@pimate/protocol";
import { validViewImage } from "./entryImages";
import type { ViewerImage } from "./imageViewer";

export type MarkdownImageKind = "remote" | "data" | "file";
export interface MarkdownImage {
	src: string;
	alt: string;
	kind: MarkdownImageKind;
	/** Position among renderable images in this message, stable as streaming appends text. */
	index: number;
}

/** Only explicit web URLs, bounded raster data, and PC paths; never pass other schemes to native image loaders. */
export function classifyImageSource(src: string): MarkdownImageKind | null {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: reject control characters at the source boundary
	if (!src || /[\0-\x1f]/.test(src)) return null;
	if (/^data:/i.test(src)) {
		if (src.length > Math.ceil(MAX_PROMPT_IMAGE_BYTES / 3) * 4 + 32) return null;
		const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.*)$/i.exec(src);
		return match && validViewImage({ mimeType: match[1].toLowerCase(), data: match[2] }, MAX_PROMPT_IMAGE_BYTES)
			? "data"
			: null;
	}
	// shortcut: Web formats/redirects are left to expo-image; inspect bytes if strict format filtering is needed.
	if (/^https?:\/\//i.test(src) || src.startsWith("file://")) {
		try {
			const url = new URL(src);
			if (/\.svgz?$/i.test(decodeURIComponent(url.pathname))) return null;
			if (url.protocol === "file:") return !url.hostname && !url.search && !url.hash ? "file" : null;
			return url.hostname && !url.username && !url.password ? "remote" : null;
		} catch {
			return null;
		}
	}
	if (/^[a-z][a-z\d+.-]*:/i.test(src) || src.startsWith("//") || /\.svgz?$/i.test(src)) return null;
	return "file";
}

/** Full file images are only requested by the viewer; tiles have independent thumbnail loaders. */
export function markdownImageGallery(
	images: MarkdownImage[],
	loadFile: ((path: string, thumbnail: boolean) => Promise<ViewImage>) | null,
): ViewerImage[] {
	return images.map((image) =>
		image.kind === "file" ? { load: () => loadFile!(image.src, false) } : { uri: image.src },
	);
}
