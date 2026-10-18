/**
 * Full-screen image viewer (Issue #66): horizontal paging, pinch / double-tap zoom, pan while zoomed, swipe down at 1x
 * to close. Always black like a photo viewer, in light and dark mode. Images never enter the disk cache.
 */
import type { PromptImage } from "@pimate/protocol";
import { Image } from "expo-image";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, type LayoutRectangle, StyleSheet, Text, View } from "react-native";
import { FlatList, Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
	type SharedValue,
	useAnimatedStyle,
	useSharedValue,
	withDecay,
	withSpring,
	withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import type { ViewerImage } from "@/lib/imageViewer";
import { clamp, DOUBLE_TAP_SCALE, fittedSize, MAX_SCALE, maxOffset, type Size, zoomAround } from "@/lib/zoom";
import { sizes } from "@/theme/tokens";
import { CloseIcon } from "../icons";
import { IconButton } from "../ui";

const BACKDROP = "#000000";
const FOREGROUND = "#FFFFFF";
const SETTLE = { duration: 200 };

export function ImageViewer({
	images,
	initialIndex,
	onClose,
}: {
	images: readonly ViewerImage[];
	initialIndex: number;
	onClose: () => void;
}) {
	const insets = useSafeAreaInsets();
	const [box, setBox] = useState<LayoutRectangle | null>(null);
	const [index, setIndex] = useState(initialIndex);
	const [zoomed, setZoomed] = useState(false);
	// Background and controls fade together while the image is dragged down.
	const backdrop = useSharedValue(1);
	const fade = useAnimatedStyle(() => ({ opacity: backdrop.get() }));

	return (
		<View style={styles.root} accessibilityViewIsModal onLayout={(e) => setBox(e.nativeEvent.layout)}>
			<StatusBar style="light" />
			<Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, fade]} />
			{box ? (
				<FlatList
					data={images}
					extraData={zoomed ? index : -1}
					keyExtractor={(_, i) => String(i)}
					horizontal
					pagingEnabled
					scrollEnabled={!zoomed && images.length > 1}
					showsHorizontalScrollIndicator={false}
					initialScrollIndex={initialIndex}
					getItemLayout={(_, i) => ({ length: box.width, offset: box.width * i, index: i })}
					windowSize={3}
					initialNumToRender={1}
					onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / box.width))}
					renderItem={({ item, index: i }) => (
						<ViewerPage
							image={item}
							label={images.length > 1 ? `画像 ${i + 1} / ${images.length}` : "画像"}
							box={box}
							zoomed={zoomed && i === index}
							backdrop={backdrop}
							onZoomChange={setZoomed}
							onDismiss={onClose}
						/>
					)}
				/>
			) : null}
			<Animated.View style={[styles.top, { paddingTop: insets.top + 4 }, fade]} pointerEvents="box-none">
				<IconButton label="閉じる" onPress={onClose}>
					<CloseIcon color={FOREGROUND} />
				</IconButton>
				{images.length > 1 ? (
					<Text style={styles.counter} accessibilityLiveRegion="polite">
						{index + 1} / {images.length}
					</Text>
				) : null}
				<View style={styles.spacer} />
			</Animated.View>
		</View>
	);
}

function ViewerPage({
	image,
	label,
	box,
	zoomed,
	backdrop,
	onZoomChange,
	onDismiss,
}: {
	image: ViewerImage;
	label: string;
	box: Size;
	/** Whether this page is zoomed in (pan moves the image) or at 1x (pan down closes the viewer). */
	zoomed: boolean;
	backdrop: SharedValue<number>;
	onZoomChange: (zoomed: boolean) => void;
	onDismiss: () => void;
}) {
	const loaded = useLoadedImage(image);
	const [failed, setFailed] = useState(false);
	const uri = typeof loaded === "object" ? `data:${loaded.mimeType};base64,${loaded.data}` : null;

	const content = useSharedValue<Size>(box);
	const scale = useSharedValue(1);
	const tx = useSharedValue(0);
	const ty = useSharedValue(0);
	const dismissY = useSharedValue(0);
	const start = useSharedValue({ scale: 1, x: 0, y: 0, fx: 0, fy: 0 });

	const gesture = useMemo(() => {
		const { width: w, height: h } = box;
		// Translation limits for a scale, so the zoomed image never leaves a gap inside the screen.
		const bound = (s: number) => {
			"worklet";
			const c = content.get();
			return { x: maxOffset(c.width, w, s), y: maxOffset(c.height, h, s) };
		};
		const settle = (s: number, x: number, y: number) => {
			"worklet";
			scale.set(withTiming(s, SETTLE));
			tx.set(withTiming(x, SETTLE));
			ty.set(withTiming(y, SETTLE));
			scheduleOnRN(onZoomChange, s > 1);
		};

		const pinch = Gesture.Pinch()
			.onStart((e) => {
				start.set({ scale: scale.get(), x: tx.get(), y: ty.get(), fx: e.focalX - w / 2, fy: e.focalY - h / 2 });
			})
			.onUpdate((e) => {
				const s0 = start.get();
				const s = clamp(s0.scale * e.scale, 1, MAX_SCALE);
				const b = bound(s);
				const fx = e.focalX - w / 2;
				const fy = e.focalY - h / 2;
				scale.set(s);
				tx.set(clamp(zoomAround(s0.fx, s0.x, s0.scale, s) + fx - s0.fx, -b.x, b.x));
				ty.set(clamp(zoomAround(s0.fy, s0.y, s0.scale, s) + fy - s0.fy, -b.y, b.y));
			})
			.onEnd(() => {
				if (scale.get() < 1.01) settle(1, 0, 0);
				else scheduleOnRN(onZoomChange, true);
			});

		const pan = zoomed
			? Gesture.Pan()
					.onStart(() => {
						start.set({ ...start.get(), x: tx.get(), y: ty.get() });
					})
					.onUpdate((e) => {
						const b = bound(scale.get());
						tx.set(clamp(start.get().x + e.translationX, -b.x, b.x));
						ty.set(clamp(start.get().y + e.translationY, -b.y, b.y));
					})
					.onEnd((e) => {
						const b = bound(scale.get());
						tx.set(withDecay({ velocity: e.velocityX, clamp: [-b.x, b.x] }));
						ty.set(withDecay({ velocity: e.velocityY, clamp: [-b.y, b.y] }));
					})
			: Gesture.Pan()
					.maxPointers(1)
					.activeOffsetY(12)
					.failOffsetX([-12, 12])
					.onUpdate((e) => {
						const y = Math.max(0, e.translationY);
						dismissY.set(y);
						backdrop.set(clamp(1 - y / (h * 0.5), 0, 1));
					})
					.onEnd((e) => {
						if (e.translationY > h * 0.15 || e.velocityY > 1000) {
							dismissY.set(withTiming(h, SETTLE));
							backdrop.set(
								withTiming(0, SETTLE, (finished) => {
									if (finished) scheduleOnRN(onDismiss);
								}),
							);
						} else {
							dismissY.set(withSpring(0));
							backdrop.set(withTiming(1, SETTLE));
						}
					});

		const doubleTap = Gesture.Tap()
			.numberOfTaps(2)
			.onEnd((e, success) => {
				if (!success) return;
				if (scale.get() > 1.01) return settle(1, 0, 0);
				const s = DOUBLE_TAP_SCALE;
				const b = bound(s);
				settle(
					s,
					clamp(zoomAround(e.x - w / 2, 0, 1, s), -b.x, b.x),
					clamp(zoomAround(e.y - h / 2, 0, 1, s), -b.y, b.y),
				);
			});

		return Gesture.Race(doubleTap, Gesture.Simultaneous(pinch, pan));
	}, [box, zoomed, content, scale, tx, ty, dismissY, start, backdrop, onZoomChange, onDismiss]);

	const imageStyle = useAnimatedStyle(() => ({
		transform: [{ translateX: tx.get() }, { translateY: ty.get() + dismissY.get() }, { scale: scale.get() }],
	}));

	return (
		<View style={{ width: box.width, height: box.height }}>
			{uri && !failed ? (
				<GestureDetector gesture={gesture}>
					<Animated.View style={[styles.fill, imageStyle]}>
						<Image
							source={{ uri }}
							style={styles.fill}
							contentFit="contain"
							cachePolicy="none"
							recyclingKey={uri}
							accessibilityLabel={label}
							onLoad={(e) => content.set(fittedSize(box, e.source))}
							onError={() => setFailed(true)}
						/>
					</Animated.View>
				</GestureDetector>
			) : (
				<View style={styles.center}>
					{loaded === "loading" ? (
						<ActivityIndicator color={FOREGROUND} accessibilityLabel="読み込み中" />
					) : (
						<Text style={styles.error}>画像を読み込めません</Text>
					)}
				</View>
			)}
		</View>
	);
}

/** The image of a page; a `load()` item is fetched when its page is first rendered (pages near the visible one). */
function useLoadedImage(image: ViewerImage): PromptImage | "loading" | "failed" {
	const [result, setResult] = useState<PromptImage | "loading" | "failed">("loading");
	useEffect(() => {
		if (!("load" in image)) return;
		let live = true;
		image.load().then(
			(loaded) => live && setResult(loaded),
			() => live && setResult("failed"),
		);
		return () => {
			live = false;
		};
	}, [image]);
	return "load" in image ? result : image;
}

const styles = StyleSheet.create({
	root: { flex: 1 },
	backdrop: { backgroundColor: BACKDROP },
	fill: { width: "100%", height: "100%" },
	center: { flex: 1, alignItems: "center", justifyContent: "center" },
	error: { color: FOREGROUND, opacity: 0.72, fontSize: 15 },
	top: {
		position: "absolute",
		top: 0,
		left: 0,
		right: 0,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		paddingHorizontal: 8,
	},
	counter: { color: FOREGROUND, fontSize: 15, fontVariant: ["tabular-nums"] },
	spacer: { width: sizes.tapTarget },
});
