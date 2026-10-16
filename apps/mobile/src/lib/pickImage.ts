import { MAX_PROMPT_IMAGE_BYTES, type PromptImage, validPromptImages } from "@pimate/protocol";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { launchImageLibraryAsync } from "expo-image-picker";

/** System photo picker: no broad photo-library permission or camera access. */
export async function pickImage(): Promise<PromptImage | null> {
	const result = await launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: false });
	if (result.canceled) return null;
	const asset = result.assets[0];
	if (
		!asset ||
		!Number.isFinite(asset.width) ||
		!Number.isFinite(asset.height) ||
		asset.width <= 0 ||
		asset.height <= 0
	)
		throw new Error("この画像は読み込めませんでした");
	const context = ImageManipulator.manipulate(asset.uri);
	try {
		if (Math.max(asset.width, asset.height) > 1600) {
			context.resize(asset.width >= asset.height ? { width: 1600 } : { height: 1600 });
		}
		const rendered = await context.renderAsync();
		try {
			const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.85, base64: true });
			const image: PromptImage = { type: "image", mimeType: "image/jpeg", data: result.base64 ?? "" };
			if (!validPromptImages([image]))
				throw new Error(
					`縮小後も画像が大きすぎます（上限 ${MAX_PROMPT_IMAGE_BYTES / 1024} KiB）。小さい画像を選んでください`,
				);
			return image;
		} finally {
			rendered.release();
		}
	} finally {
		context.release();
	}
}
