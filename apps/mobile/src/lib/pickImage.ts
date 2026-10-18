import { type PromptImage, validPromptImages } from "@pimate/protocol";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { launchImageLibraryAsync } from "expo-image-picker";
import { base64Bytes } from "./entryImages";
import { newImageBudget } from "./promptImages";

const budgetError = () =>
	new Error("画像は1枚512 KiB・合計600 KiBまでです。添付を減らすか、小さい画像を選んでください。");

/** System picker, with a decoded-byte allowance for each new photo; cancellation leaves the draft unchanged. */
export async function pickImages(existing: PromptImage[], limit: number): Promise<PromptImage[] | null> {
	const remaining = limit - existing.length;
	if (remaining <= 0) throw new Error(`画像は${limit}枚まで添付できます。`);
	const result = await launchImageLibraryAsync({
		mediaTypes: ["images"],
		allowsMultipleSelection: true,
		selectionLimit: remaining,
	});
	if (result.canceled) return null;
	if (!result.assets.length || result.assets.length > remaining) throw new Error(`画像は${limit}枚まで添付できます。`);
	const budget = newImageBudget(existing, result.assets.length);
	if (budget <= 0) throw budgetError();
	const images = [...existing];
	for (const asset of result.assets) {
		if (!Number.isFinite(asset.width) || !Number.isFinite(asset.height) || asset.width <= 0 || asset.height <= 0)
			throw new Error("この画像は読み込めませんでした");
		let accepted = false;
		for (const [edge, quality] of [
			[1600, 0.85],
			[1200, 0.7],
			[800, 0.55],
			[512, 0.4],
			[320, 0.3],
		] as const) {
			const context = ImageManipulator.manipulate(asset.uri);
			try {
				if (Math.max(asset.width, asset.height) > edge)
					context.resize(asset.width >= asset.height ? { width: edge } : { height: edge });
				const rendered = await context.renderAsync();
				try {
					const output = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: quality, base64: true });
					const image: PromptImage = { type: "image", mimeType: "image/jpeg", data: output.base64 ?? "" };
					if (validPromptImages([image]) && base64Bytes(image.data) <= budget) {
						images.push(image);
						accepted = true;
						break;
					}
				} finally {
					rendered.release();
				}
			} finally {
				context.release();
			}
		}
		if (!accepted) throw budgetError();
	}
	if (!validPromptImages(images)) throw budgetError();
	return images;
}
