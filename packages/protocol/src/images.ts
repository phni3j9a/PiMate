/** One small image per prompt keeps requests below the Host's 1 MiB WebSocket limit. */
export const MAX_PROMPT_IMAGE_BYTES = 512 * 1024;
export const MAX_IMAGE_PROMPT_TEXT = 32 * 1024;

export interface PromptImage {
	type: "image";
	mimeType: "image/jpeg" | "image/png" | "image/webp";
	data: string;
}

export function validPromptImages(value: unknown): value is PromptImage[] {
	return (
		Array.isArray(value) &&
		value.length <= 1 &&
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
			return bytes <= MAX_PROMPT_IMAGE_BYTES;
		})
	);
}

export function samePromptImages(a: readonly PromptImage[] = [], b: readonly PromptImage[] = []): boolean {
	return a.length === b.length && a.every((image, i) => image.mimeType === b[i]?.mimeType && image.data === b[i]?.data);
}
