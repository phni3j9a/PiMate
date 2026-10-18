/**
 * Zoom math for the image viewer (pure, no React Native imports; also called as worklets on the UI thread).
 * Coordinates are relative to the page center, matching a `[translateX, translateY, scale]` transform.
 */
export const MIN_SCALE = 1;
export const MAX_SCALE = 4;
export const DOUBLE_TAP_SCALE = 2.5;

export interface Size {
	width: number;
	height: number;
}

/** Size of an image drawn with `contentFit="contain"` in `box`; the box itself while the natural size is unknown. */
export function fittedSize(box: Size, natural: Size | null): Size {
	"worklet";
	if (!natural || natural.width <= 0 || natural.height <= 0) return box;
	const f = Math.min(box.width / natural.width, box.height / natural.height);
	return { width: natural.width * f, height: natural.height * f };
}

/** Largest translation on one axis that keeps the zoomed content covering the box (0 while it fits). */
export function maxOffset(content: number, box: number, scale: number): number {
	"worklet";
	return Math.max(0, (content * scale - box) / 2);
}

export function clamp(value: number, min: number, max: number): number {
	"worklet";
	return Math.min(max, Math.max(min, value));
}

/** Translation on one axis after zooming from `fromScale` to `toScale` while keeping `focal` fixed on screen. */
export function zoomAround(focal: number, translate: number, fromScale: number, toScale: number): number {
	"worklet";
	return focal - (toScale / fromScale) * (focal - translate);
}
