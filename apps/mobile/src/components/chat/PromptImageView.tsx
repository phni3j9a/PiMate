/** Bounded image preview that opens the full-screen viewer on tap; attachments never enter the disk cache. */
import type { ViewImage } from "@pimate/protocol";
import { Image } from "expo-image";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { openImageViewer } from "@/lib/imageViewer";
import { colors, radii } from "@/theme/tokens";

export function PromptImageView({
	image,
	compact = false,
	onPress,
}: {
	image: ViewImage;
	compact?: boolean;
	onPress?: () => void;
}) {
	const [failed, setFailed] = useState<string | null>(null);
	const uri = useMemo(() => `data:${image.mimeType};base64,${image.data}`, [image.mimeType, image.data]);
	const broken = failed === uri;
	return (
		<Pressable
			style={({ pressed }) => [styles.frame, compact && styles.compact, pressed && styles.pressed]}
			onPress={onPress ?? (() => openImageViewer([image]))}
			disabled={broken && !onPress}
			accessibilityRole="imagebutton"
			accessibilityLabel={broken ? "画像を表示できません。画像一覧を開く" : "添付画像を拡大"}
		>
			{broken ? (
				<Text style={styles.fallback}>画像を表示できません</Text>
			) : (
				<Image
					source={{ uri }}
					style={styles.image}
					contentFit="contain"
					cachePolicy="none"
					recyclingKey={uri}
					onError={() => setFailed(uri)}
				/>
			)}
		</Pressable>
	);
}

const styles = StyleSheet.create({
	frame: {
		width: 180,
		maxWidth: "100%",
		height: 140,
		borderRadius: radii.input,
		borderCurve: "continuous",
		overflow: "hidden",
		backgroundColor: colors.surfaceStrong,
		justifyContent: "center",
	},
	compact: { width: 64, height: 64 },
	pressed: { opacity: 0.6 },
	image: { width: "100%", height: "100%" },
	fallback: { color: colors.textSecondary, fontSize: 11, textAlign: "center" },
});
