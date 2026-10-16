/** Bounded, non-interactive image preview; attachments never enter the disk cache. */
import type { PromptImage } from "@pimate/protocol";
import { Image } from "expo-image";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, radii } from "@/theme/tokens";

export function PromptImageView({ image, compact = false }: { image: PromptImage; compact?: boolean }) {
	const [failed, setFailed] = useState<string | null>(null);
	const uri = useMemo(() => `data:${image.mimeType};base64,${image.data}`, [image.mimeType, image.data]);
	return (
		<View style={[styles.frame, compact && styles.compact]}>
			{failed === uri ? (
				<Text style={styles.fallback}>画像を表示できません</Text>
			) : (
				<Image
					source={{ uri }}
					style={styles.image}
					contentFit="contain"
					cachePolicy="none"
					recyclingKey={uri}
					accessibilityLabel="添付画像"
					onError={() => setFailed(uri)}
				/>
			)}
		</View>
	);
}

const styles = StyleSheet.create({
	frame: {
		width: 180,
		maxWidth: "100%",
		height: 140,
		borderRadius: radii.input,
		overflow: "hidden",
		backgroundColor: colors.surfaceStrong,
		justifyContent: "center",
	},
	compact: { width: 64, height: 64 },
	image: { width: "100%", height: "100%" },
	fallback: { color: colors.textSecondary, fontSize: 11, textAlign: "center" },
});
