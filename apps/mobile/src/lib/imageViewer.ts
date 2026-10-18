/**
 * Opens the full-screen image viewer route (src/app/image-viewer.tsx). Images are handed over in memory, never as
 * route params (base64 is too large for a URL) and never written to disk.
 */
import type { ViewImage } from "@pimate/protocol";
import { router } from "expo-router";
import { Keyboard } from "react-native";

/** A loaded image, or one fetched when its page is first shown (spinner, then 「画像を読み込めません」 on rejection). */
export type UriImage = { uri: string };
export type LazyViewImage = ViewImage | { load: () => Promise<ViewImage> };
export type ViewerImage = LazyViewImage | UriImage;

export interface ViewerRequest {
	images: readonly ViewerImage[];
	index: number;
}

let current: ViewerRequest | null = null;
let openedAt = 0;

/** Shows `images` starting at `index`. A second call within a second (a double tap on a thumbnail) is ignored. */
export function openImageViewer(images: readonly ViewerImage[], index = 0): void {
	if (!images.length || Date.now() - openedAt < 1000) return;
	openedAt = Date.now();
	current = { images, index: Math.min(Math.max(0, index), images.length - 1) };
	Keyboard.dismiss();
	router.push("/image-viewer");
}

/** The request the viewer route shows; null when the route is opened without one (e.g. restored after a reload). */
export function imageViewerRequest(): ViewerRequest | null {
	return current;
}

/** Called when the viewer unmounts so the images are not kept alive. */
export function releaseImageViewerRequest(request: ViewerRequest | null): void {
	if (current === request) current = null;
}
