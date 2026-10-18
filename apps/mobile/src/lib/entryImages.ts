import type { PromptImage, TranscriptImages, ViewImage } from "@pimate/protocol";
import type { ViewerImage } from "./imageViewer";

export const MAX_IMAGE_CACHE_BYTES = 24 * 1024 * 1024;
const MAX_VIEW_BYTES = 5 * 1024 * 1024;

/** LRU of base64 strings only, never disk. In-flight requests are shared; failures are not cached. */
export class EntryImageCache {
	private images = new Map<string, ViewImage>();
	private pending = new Map<string, Promise<ViewImage>>();
	private bytes = 0;
	private tail: Promise<unknown> = Promise.resolve();

	constructor(private readonly limit = MAX_IMAGE_CACHE_BYTES) {}

	load(key: string, fetch: () => Promise<ViewImage>): Promise<ViewImage> {
		const cached = this.images.get(key);
		if (cached) {
			this.images.delete(key);
			this.images.set(key, cached);
			return Promise.resolve(cached);
		}
		const pending = this.pending.get(key);
		if (pending) return pending;
		// Serialize distinct fetches so large image replies do not burst past the Host outbound cutoff.
		const request = this.tail
			.then(fetch)
			.then((image) => {
				// Conservatively count UTF-16 base64 storage, not just decoded file bytes.
				const size = image.data.length * 2;
				if (size <= this.limit) {
					while (this.bytes + size > this.limit) {
						const oldest = this.images.keys().next().value!;
						this.bytes -= this.images.get(oldest)!.data.length * 2;
						this.images.delete(oldest);
					}
					this.images.set(key, image);
					this.bytes += size;
				}
				return image;
			})
			.finally(() => this.pending.delete(key));
		this.tail = request.then(
			() => {},
			() => {},
		);
		this.pending.set(key, request);
		return request;
	}
}

export function validViewImage(value: unknown, maxBytes = MAX_VIEW_BYTES): value is ViewImage {
	if (!value || typeof value !== "object") return false;
	const image = value as ViewImage;
	return (
		["image/jpeg", "image/png", "image/webp", "image/gif"].includes(image.mimeType) &&
		typeof image.data === "string" &&
		image.data.length > 0 &&
		image.data.length <= Math.ceil(maxBytes / 3) * 4 &&
		image.data.length % 4 === 0 &&
		/^[A-Za-z0-9+/]*={0,2}$/.test(image.data) &&
		base64Bytes(image.data) <= maxBytes
	);
}

export function base64Bytes(data: string): number {
	return (data.length / 4) * 3 - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
}

/** Preview array positions are not original indices when an earlier image was omitted. */
export function imageSlots(item: TranscriptImages): (PromptImage | undefined)[] {
	const images = item.images ?? [];
	const count = Number.isSafeInteger(item.imageCount) && item.imageCount! >= 0 ? item.imageCount! : images.length;
	const slots = Array<PromptImage | undefined>(count).fill(undefined);
	images.forEach((image, i) => {
		const index = item.imageIndices?.[i] ?? i;
		if (Number.isSafeInteger(index) && index >= 0 && index < count) slots[index] = image;
	});
	return slots;
}

/** Four tiles maximum; the last opens the first image hidden by the +N tile. */
export function imageTiles(count: number): { index: number; more?: number }[] {
	return Array.from({ length: Math.min(count, 4) }, (_, index) => ({
		index,
		...(index === 3 && count > 4 ? { more: count - 3 } : {}),
	}));
}

/** Tiles and viewer must not share a lazy full-image source: mounted rows retain tile results. */
export function entryImageSources(
	item: TranscriptImages,
	load?: (index: number, thumbnail: boolean) => Promise<ViewImage>,
): { gallery: ViewerImage[]; thumbnails: ViewerImage[] } {
	const slots = imageSlots(item);
	if (!load) {
		const inline = slots.filter((image) => image !== undefined);
		return { gallery: inline, thumbnails: inline };
	}
	return {
		gallery: slots.map((image, index) => image ?? { load: () => load(index, false) }),
		thumbnails: slots.map((image, index) => image ?? { load: () => load(index, true) }),
	};
}
