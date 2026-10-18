export const MAX_PROMPT_IMAGES = 4;
// 600 KiB * 4/3 base64 + 32 Ki UTF-16 units * 6 JSON escaping + envelope < 1 MiB.
export const MAX_PROMPT_TOTAL_IMAGE_BYTES = 600 * 1024;
export const MAX_PROMPT_IMAGE_BYTES = 512 * 1024;
export const MAX_IMAGE_PROMPT_TEXT = 32 * 1024;

export interface PromptImage {
	type: "image";
	mimeType: "image/jpeg" | "image/png" | "image/webp";
	data: string;
}

/** On-demand display image; unlike prompt previews, GIF is supported too. */
export interface ViewImage {
	mimeType: PromptImage["mimeType"] | "image/gif";
	data: string;
	width?: number;
	height?: number;
}

export function validPromptImages(value: unknown): value is PromptImage[] {
	let total = 0;
	return (
		Array.isArray(value) &&
		value.length <= MAX_PROMPT_IMAGES &&
		value.every((image) => {
			if (
				!image ||
				typeof image !== "object" ||
				image.type !== "image" ||
				!["image/jpeg", "image/png", "image/webp"].includes(image.mimeType) ||
				typeof image.data !== "string"
			)
				return false;
			const data = image.data;
			if (
				!data.length ||
				data.length > Math.ceil(MAX_PROMPT_IMAGE_BYTES / 3) * 4 ||
				data.length % 4 !== 0 ||
				!/^[A-Za-z0-9+/]*={0,2}$/.test(data)
			)
				return false;
			const bytes = (data.length / 4) * 3 - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
			total += bytes;
			return bytes <= MAX_PROMPT_IMAGE_BYTES && total <= MAX_PROMPT_TOTAL_IMAGE_BYTES;
		})
	);
}

export function samePromptImages(a: readonly PromptImage[] = [], b: readonly PromptImage[] = []): boolean {
	return a.length === b.length && a.every((image, i) => image.mimeType === b[i]?.mimeType && image.data === b[i]?.data);
}
