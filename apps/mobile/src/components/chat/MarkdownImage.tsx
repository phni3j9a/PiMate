import type { ViewImage } from "@pimate/protocol";
import { Image } from "expo-image";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";
import type { MarkdownImage } from "@/lib/markdownImages";
import { colors, radii } from "@/theme/tokens";

/** Like entry images, the chat captures the host/instance/session/cwd before providing this loader. */
export const FileImageContext = createContext<
	((path: string, thumbnail: boolean, scope?: string) => Promise<ViewImage>) | null
>(null);

export function MarkdownImageTile({ image, onPress }: { image: MarkdownImage; onPress: () => void }) {
	const load = useContext(FileImageContext);
	const { src, kind, alt } = image;
	const [thumbnail, setThumbnail] = useState<ViewImage | "loading" | "failed">("loading");
	useEffect(() => {
		if (kind !== "file" || !load) return;
		let active = true;
		setThumbnail("loading");
		load(src, true).then(
			(value) => active && setThumbnail(value),
			() => active && setThumbnail("failed"),
		);
		return () => {
			active = false;
		};
	}, [src, kind, load]);
	const uri =
		kind !== "file"
			? src
			: typeof thumbnail === "object"
				? `data:${thumbnail.mimeType};base64,${thumbnail.data}`
				: null;
	return uri ? (
		<UriTile key={uri} uri={uri} alt={alt} onPress={onPress} />
	) : (
		<Pressable
			style={styles.tile}
			onPress={onPress}
			accessibilityRole="imagebutton"
			accessibilityLabel={`${alt || "画像"}を拡大`}
		>
			{thumbnail === "failed" ? (
				<Text style={styles.error}>
					{alt || "画像"}
					{"\n"}画像を読み込めません
				</Text>
			) : (
				<ActivityIndicator color={colors.textSecondary} accessibilityLabel="読み込み中" />
			)}
		</Pressable>
	);
}

function UriTile({ uri, alt, onPress }: { uri: string; alt: string; onPress: () => void }) {
	const source = useMemo(() => ({ uri }), [uri]);
	const [status, setStatus] = useState<"loading" | "loaded" | "failed">("loading");
	return (
		<Pressable
			style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
			onPress={onPress}
			accessibilityRole="imagebutton"
			accessibilityLabel={`${alt || "画像"}を拡大${status === "failed" ? "、読み込み失敗" : ""}`}
		>
			{status === "failed" ? (
				<Text style={styles.error}>
					{alt || "画像"}
					{"\n"}画像を読み込めません
				</Text>
			) : (
				<Image
					source={source}
					style={[StyleSheet.absoluteFill, status === "loading" && { opacity: 0 }]}
					contentFit="contain"
					cachePolicy="none"
					recyclingKey={uri}
					onLoad={() => setStatus("loaded")}
					onError={() => setStatus("failed")}
				/>
			)}
			{status === "loading" ? <ActivityIndicator color={colors.textSecondary} accessibilityLabel="読み込み中" /> : null}
		</Pressable>
	);
}

const styles = StyleSheet.create({
	tile: {
		width: 180,
		maxWidth: "100%",
		height: 140,
		borderRadius: radii.input,
		borderCurve: "continuous",
		overflow: "hidden",
		backgroundColor: colors.surfaceStrong,
		alignItems: "center",
		justifyContent: "center",
	},
	pressed: { opacity: 0.6 },
	error: { color: colors.textSecondary, fontSize: 11, textAlign: "center", padding: 8 },
});
