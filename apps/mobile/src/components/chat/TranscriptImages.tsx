import type { TranscriptImages as Images, ViewImage } from "@pimate/protocol";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { entryImageSources, imageTiles } from "@/lib/entryImages";
import { openImageViewer, type ViewerImage } from "@/lib/imageViewer";
import { colors, radii } from "@/theme/tokens";
import { PromptImageView } from "./PromptImageView";

/** Provided only by the parent chat, captured with its host/instance/session target. */
export const EntryImageContext = createContext<
	((entryId: string, index: number, thumbnail: boolean) => Promise<ViewImage>) | null
>(null);

export function TranscriptImages({ entryId, ...item }: Images & { entryId?: string }) {
	const fetch = useContext(EntryImageContext);
	const { images, imageIndices, imageCount } = item;
	const canLoad = !!fetch && !!entryId;
	const { gallery, thumbnails } = useMemo(
		() =>
			entryImageSources(
				{ images, imageIndices, imageCount },
				canLoad ? (index, thumbnail) => fetch!(entryId!, index, thumbnail) : undefined,
			),
		[images, imageIndices, imageCount, canLoad, fetch, entryId],
	);
	const missing = (imageCount ?? images?.length ?? 0) - gallery.length;
	if (!gallery.length && !missing) return null;
	return (
		<View style={styles.wrap}>
			<View style={[styles.grid, gallery.length === 1 && styles.singleGrid]}>
				{imageTiles(gallery.length).map(({ index, more }) => (
					<ImageTile
						key={index}
						image={thumbnails[index]!}
						index={index}
						more={more}
						compact={gallery.length > 1}
						onPress={() => openImageViewer(gallery, index)}
					/>
				))}
			</View>
			{!canLoad && missing > 0 ? (
				<Text style={styles.meta}>
					画像 {imageCount} 枚{images?.length ? "（残りは表示対象外）" : "（プレビューの制限で表示なし）"}
				</Text>
			) : null}
		</View>
	);
}

function ImageTile({
	image,
	index,
	more,
	compact,
	onPress,
}: {
	image: ViewerImage;
	index: number;
	more?: number;
	compact: boolean;
	onPress: () => void;
}) {
	// Mounted rows retain this state, so its lazy source must only request thumbnails.
	const [loaded, setLoaded] = useState<ViewImage | "loading" | "failed">("loading");
	useEffect(() => {
		if (!("load" in image) || more) return;
		let active = true;
		setLoaded("loading");
		image.load().then(
			(value) => active && setLoaded(value),
			() => active && setLoaded("failed"),
		);
		return () => {
			active = false;
		};
	}, [image, more]);
	const value = "load" in image ? loaded : image;
	if (!more && typeof value === "object") return <PromptImageView image={value} compact={compact} onPress={onPress} />;
	return (
		<Pressable
			onPress={onPress}
			style={({ pressed }) => [styles.tile, !compact && styles.singleTile, pressed && styles.pressed]}
			accessibilityRole="imagebutton"
			accessibilityLabel={
				more
					? `残り${more}枚の画像を表示`
					: `画像${index + 1}、${value === "failed" ? "タップして全画面で開く" : "読み込み中"}`
			}
		>
			{more ? (
				<Text style={styles.more}>+{more}</Text>
			) : value === "failed" ? (
				<Text style={styles.error}>タップして開く</Text>
			) : (
				<ActivityIndicator size="small" color={colors.textSecondary} />
			)}
		</Pressable>
	);
}

const styles = StyleSheet.create({
	wrap: { gap: 4 },
	grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, maxWidth: 136 },
	singleGrid: { maxWidth: 180 },
	singleTile: { width: 180, height: 140 },
	tile: {
		width: 64,
		height: 64,
		borderRadius: radii.input,
		borderCurve: "continuous",
		backgroundColor: colors.surfaceStrong,
		alignItems: "center",
		justifyContent: "center",
	},
	pressed: { opacity: 0.6 },
	more: { color: colors.text, fontSize: 18, fontWeight: "600" },
	error: { color: colors.statusFailedText, fontSize: 10, textAlign: "center", padding: 4 },
	meta: { color: colors.textSecondary, fontSize: 11 },
});
