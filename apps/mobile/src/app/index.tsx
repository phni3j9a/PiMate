import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, radii, sizes, spacing, typography } from "@/theme/tokens";

/**
 * M0 placeholder of the chat screen (docs/design/png/Main.png): a static shell with no networking.
 * The Host connection, drawer and transcript arrive in M1+.
 */
export default function ChatScreen() {
	const insets = useSafeAreaInsets();
	const [draft, setDraft] = useState("");
	const canSend = draft.trim().length > 0;

	return (
		<SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
			<KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
				<View style={styles.header}>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel="Instance 一覧を開く"
						// TODO(M1): open the Pi Instance drawer.
						onPress={() => {}}
						style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
					>
						<DrawerIcon />
					</Pressable>
					<Text style={styles.title} numberOfLines={1} accessibilityRole="header">
						PiMate
					</Text>
					<View style={styles.status} accessible accessibilityLabel="状態: 未接続">
						<View style={styles.idleDot} />
						<Text style={styles.statusText}>未接続</Text>
					</View>
				</View>

				<View style={styles.transcript}>
					<Text style={styles.emptyText}>Hostに接続していません</Text>
				</View>

				<View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
					<View style={styles.composer}>
						<TextInput
							style={styles.input}
							value={draft}
							onChangeText={setDraft}
							placeholder="Pi にメッセージ"
							placeholderTextColor={colors.textSecondary}
							accessibilityLabel="メッセージ"
							multiline
						/>
						<View style={styles.composerActions}>
							<Pressable
								accessibilityRole="button"
								accessibilityLabel="送信"
								accessibilityState={{ disabled: !canSend }}
								disabled={!canSend}
								// TODO(M1): send to the connected Pi Instance.
								onPress={() => {}}
								style={({ pressed }) => [
									styles.sendButton,
									!canSend && styles.sendButtonDisabled,
									pressed && styles.pressed,
								]}
							>
								<SendIcon color={canSend ? colors.onAccent : colors.textSecondary} />
							</Pressable>
						</View>
					</View>
				</View>
			</KeyboardAvoidingView>
		</SafeAreaView>
	);
}

/** Two left-aligned strokes (mock: 22px, `M4 8h16M4 16h10`, stroke 1.9). Drawn with Views to avoid an SVG dependency. */
function DrawerIcon() {
	return (
		<View style={styles.drawerIcon}>
			<View style={[styles.drawerLine, { width: 15 }]} />
			<View style={[styles.drawerLine, { width: 9 }]} />
		</View>
	);
}

/** Up arrow (mock: 18px, `M12 19V5M6 11l6-6 6 6`, stroke 2.2). */
function SendIcon({ color }: { color: string }) {
	return (
		<View style={styles.sendIcon}>
			<View style={[styles.sendChevron, { borderColor: color }]} />
			<View style={[styles.sendShaft, { backgroundColor: color }]} />
		</View>
	);
}

const SEND_STROKE = 1.75;

const styles = StyleSheet.create({
	flex: { flex: 1 },
	screen: { flex: 1, backgroundColor: colors.background },
	pressed: { opacity: 0.6 },

	header: {
		height: spacing.headerHeight,
		flexDirection: "row",
		alignItems: "center",
		gap: 2,
		paddingHorizontal: 6,
	},
	iconButton: {
		width: sizes.tapTarget,
		height: sizes.tapTarget,
		borderRadius: 10,
		alignItems: "center",
		justifyContent: "center",
	},
	title: { ...typography.headerTitle, flex: 1, color: colors.text },
	status: {
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
		// Aligns the status text with the 20px screen side (6 header padding + 14).
		paddingHorizontal: spacing.screenSide - 6,
	},
	idleDot: {
		width: 5,
		height: 5,
		borderRadius: 3,
		backgroundColor: colors.statusIdle,
		opacity: colors.statusIdleOpacity,
	},
	statusText: { ...typography.caption, color: colors.textSecondary },

	transcript: {
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
		paddingHorizontal: spacing.screenSide,
	},
	emptyText: { ...typography.body, color: colors.textSecondary, textAlign: "center" },

	footer: { paddingTop: 6, paddingHorizontal: 16, backgroundColor: colors.background },
	composer: {
		paddingTop: 12,
		paddingRight: 8,
		paddingBottom: 6,
		paddingLeft: 14,
		borderRadius: radii.input,
		backgroundColor: colors.surface,
	},
	input: {
		...typography.composer,
		color: colors.text,
		maxHeight: typography.composer.lineHeight * 6,
		padding: 0,
		textAlignVertical: "top",
	},
	composerActions: {
		marginTop: 6,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "flex-end",
	},
	sendButton: {
		width: sizes.composerControl,
		height: sizes.composerControl,
		borderRadius: radii.capsule,
		backgroundColor: colors.accent,
		alignItems: "center",
		justifyContent: "center",
	},
	sendButtonDisabled: { backgroundColor: colors.surfaceStrong },

	drawerIcon: { width: 22, height: 22, justifyContent: "center", gap: 5.5, paddingLeft: 3.5 },
	drawerLine: { height: 1.75, borderRadius: 1, backgroundColor: colors.text },
	sendIcon: { width: 18, height: 18, alignItems: "center" },
	sendChevron: {
		position: "absolute",
		top: 4.5,
		width: 8,
		height: 8,
		borderTopWidth: SEND_STROKE,
		borderLeftWidth: SEND_STROKE,
		borderTopLeftRadius: 1,
		transform: [{ rotate: "45deg" }],
	},
	sendShaft: { position: "absolute", top: 4, width: SEND_STROKE, height: 10.5, borderRadius: 1 },
});
